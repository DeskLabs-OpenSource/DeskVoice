/**
 * Bancada da voz do pipeline (R5, fatia 1a): o tempo do primeiro `push` ao primeiro áudio e a
 * contagem de caracteres contra o consumo da conta. Fora do CI; só roda com a chave do pedido de
 * decisão da DESA-13 e com teto próprio.
 *
 *   # Só com a chave entregue por canal privado, nunca a de outro programa:
 *   # export BANCADA_ELEVENLABS_API_KEY=...
 *   pnpm exec tsx scripts/bancada-de-voz/sintetizador.ts --voz <voice_id> --teto-usd 0.05 [--modelo eleven_flash_v2_5]
 *
 * O que ela mede, e como:
 * - **Tempo até o primeiro áudio:** 30 falas curtas em pt-BR, uma de cada vez. O relógio começa no
 *   primeiro `push` (a fala já aberta, como o pipeline faz) e para no primeiro `audio`. Sai p50 e
 *   p95 pelo vizinho mais próximo (`percentil` de `metricas.ts`). A abertura do WebSocket fica de
 *   fora e sai à parte, porque o pipeline pode abrir a fala antes do texto chegar.
 * - **Caracteres contra a conta:** lê `character_count` de `GET /v1/user/subscription` antes e
 *   depois (fonte: https://elevenlabs.io/docs/api-reference/user/subscription/get, 17/11/2026) e
 *   compara a diferença com o que a peça contou no `usage`. Se a chave não tiver permissão de ler a
 *   assinatura, a bancada diz "não exposto" e não inventa número.
 * - **Forma do áudio:** confere que `pcm_8000` chegou em número par de bytes e com duração
 *   plausível (bytes ÷ 16 000 = segundos). Não ouve o áudio: isso é de quem roda.
 *
 * O teto (`orcamento.ts`) reserva o pior caso de cada fala (caracteres × preço do modelo) antes de
 * abrir. Modelo sem preço não roda: o custo não seria medido.
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import synthesizer from "../../packages/voice-engine/src/synthesizers/elevenlabs";
import { countCharacters, speechCostMicrocents } from "../../packages/voice-engine/src/synthesis";
import { MICROCENTS_PER_CENT } from "../../packages/voice-engine/src/pricing";
import { percentil } from "./metricas";
import { Orcamento } from "./orcamento";

/** Falas curtas, como as de um agente ao telefone. Sem nome de pessoa real nem dado pessoal. */
export const FRASES: readonly string[] = [
  "Bom dia, em que posso ajudar?",
  "Claro, vou verificar para você.",
  "Só um momento, por favor.",
  "Pode repetir o seu nome?",
  "Qual é o melhor horário para você?",
  "Temos vaga na terça às dez horas.",
  "Perfeito, está agendado.",
  "Vou transferir para um atendente.",
  "O endereço é Rua das Flores, número cem.",
  "Aceitamos cartão e pix.",
  "O valor da consulta é cento e vinte reais.",
  "Desculpe, não entendi. Pode repetir?",
  "Quer que eu confirme por mensagem?",
  "O horário de atendimento é das oito às dezoito.",
  "Posso ajudar em mais alguma coisa?",
  "Obrigado pela ligação, tenha um bom dia.",
  "Entendi, vou anotar o seu pedido.",
  "O prazo de entrega é de três dias úteis.",
  "Sim, funcionamos aos sábados pela manhã.",
  "Vou precisar do seu telefone com DDD.",
  "Certo, o seu protocolo é quatro cinco seis.",
  "Infelizmente esse horário já está ocupado.",
  "Prefere de manhã ou à tarde?",
  "A clínica fica perto da estação.",
  "Tem estacionamento no local.",
  "Pode chegar quinze minutos antes.",
  "O retorno é gratuito em trinta dias.",
  "Vou registrar a sua reclamação agora.",
  "Um especialista vai retornar a ligação.",
  "Até logo, e obrigado.",
];

export interface MedidaDeFala {
  frase: string;
  caracteres: number;
  /** Do `connect` ao `speak` resolvido. */
  aberturaMs: number;
  /** Do primeiro `push` ao primeiro `audio`. Nulo se não veio áudio. */
  primeiroAudioMs: number | null;
  bytes: number;
  erro?: string;
}

export interface ResumoDaVoz {
  falas: number;
  comAudio: number;
  primeiroAudioP50Ms: number | null;
  primeiroAudioP95Ms: number | null;
  aberturaP50Ms: number | null;
  caracteresContados: number;
  /** Bytes ímpares numa fala: o PCM16 não veio inteiro. */
  falasComBytesImpares: number;
  /** Segundos de áudio pela conta do PCM16 8 kHz. */
  segundosDeAudio: number;
}

export function resumir(medidas: readonly MedidaDeFala[]): ResumoDaVoz {
  const primeiros = medidas.map((m) => m.primeiroAudioMs).filter((v): v is number => v !== null);
  return {
    falas: medidas.length,
    comAudio: primeiros.length,
    primeiroAudioP50Ms: percentil(primeiros, 50),
    primeiroAudioP95Ms: percentil(primeiros, 95),
    aberturaP50Ms: percentil(
      medidas.map((m) => m.aberturaMs),
      50,
    ),
    caracteresContados: medidas.reduce((soma, m) => soma + m.caracteres, 0),
    falasComBytesImpares: medidas.filter((m) => m.bytes % 2 !== 0).length,
    segundosDeAudio: medidas.reduce((soma, m) => soma + m.bytes, 0) / 16_000,
  };
}

/** A comparação com a conta: `null` quando a conta não expôs o contador. */
export function compararComAConta(contados: number, antes: number | null, depois: number | null): { cobrados: number; diferenca: number } | null {
  if (antes === null || depois === null) return null;
  const cobrados = depois - antes;
  return { cobrados, diferenca: cobrados - contados };
}

async function contadorDaConta(apiKey: string): Promise<number | null> {
  try {
    const resposta = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(10_000) });
    if (!resposta.ok) return null;
    const corpo = (await resposta.json()) as { character_count?: unknown };
    return typeof corpo.character_count === "number" ? corpo.character_count : null;
  } catch {
    return null;
  }
}

async function medirUma(frase: string, voiceId: string, model: string, apiKey: string): Promise<MedidaDeFala> {
  const caracteres = countCharacters(frase);
  const t0 = performance.now();
  const speech = await synthesizer.speak({ voiceId, language: "pt-BR", model }, apiKey);
  const aberturaMs = performance.now() - t0;
  return await new Promise((resolve) => {
    let primeiroAudioMs: number | null = null;
    let bytes = 0;
    let inicio = 0;
    const prazo = setTimeout(() => {
      speech.cancel();
      resolve({ frase, caracteres, aberturaMs, primeiroAudioMs, bytes, erro: "prazo de 30 s" });
    }, 30_000);
    speech.on("audio", (pcm) => {
      if (primeiroAudioMs === null) primeiroAudioMs = performance.now() - inicio;
      bytes += pcm.length;
    });
    speech.on("error", (erro) => {
      clearTimeout(prazo);
      resolve({ frase, caracteres, aberturaMs, primeiroAudioMs, bytes, erro: erro.message });
    });
    speech.on("done", () => {
      clearTimeout(prazo);
      resolve({ frase, caracteres, aberturaMs, primeiroAudioMs, bytes });
    });
    inicio = performance.now();
    speech.push(frase, { flush: true });
    speech.end();
  });
}

async function principal(): Promise<void> {
  const { values } = parseArgs({ options: { voz: { type: "string" }, "teto-usd": { type: "string" }, modelo: { type: "string" } } });
  const apiKey = process.env.BANCADA_ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("BANCADA_ELEVENLABS_API_KEY não definido: sem a chave do pedido de decisão, o PR diz \"não medido\"");
  if (!values.voz) throw new Error("--voz <voice_id> é obrigatório");
  const tetoUsd = Number(values["teto-usd"]);
  if (!Number.isFinite(tetoUsd) || tetoUsd < 0) throw new Error("--teto-usd é obrigatório");
  const model = values.modelo ?? synthesizer.defaultModel;
  const preco = synthesizer.pricingOf(model);
  if (preco === undefined) throw new Error(`${model}: sem preço conhecido, o custo não seria medido`);
  const orcamento = new Orcamento(tetoUsd);
  const usdDe = (caracteres: number): number => (speechCostMicrocents(preco, caracteres) ?? 0) / MICROCENTS_PER_CENT / 100;

  const antes = await contadorDaConta(apiKey);
  const medidas: MedidaDeFala[] = [];
  for (const frase of FRASES) {
    const reserva = orcamento.reservar(usdDe(countCharacters(frase)), "elevenlabs");
    if (reserva === null) {
      process.stdout.write(`Teto de US$ ${tetoUsd} atingido: parei antes de "${frase}".\n`);
      break;
    }
    const medida = await medirUma(frase, values.voz, model, apiKey).catch((erro: unknown) => ({
      frase,
      caracteres: countCharacters(frase),
      aberturaMs: 0,
      primeiroAudioMs: null,
      bytes: 0,
      erro: erro instanceof Error ? erro.message : String(erro),
    }));
    // A abertura recusada não enviou texto; a que abriu cobrou a frase inteira.
    reserva.fechar(medida.aberturaMs > 0 ? usdDe(medida.caracteres) : 0);
    medidas.push(medida);
  }
  // O contador da conta pode demorar a andar: espera antes de ler de novo.
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const depois = await contadorDaConta(apiKey);
  const resumo = resumir(medidas);
  const conta = compararComAConta(
    medidas.filter((m) => m.aberturaMs > 0).reduce((soma, m) => soma + m.caracteres, 0),
    antes,
    depois,
  );
  // A chave nunca sai na saída, nem dentro de uma mensagem de erro.
  const saida = JSON.stringify({ modelo: model, resumo, conta: conta ?? "não exposto", gastoUsd: orcamento.gasto, erros: medidas.filter((m) => m.erro) }, null, 2);
  process.stdout.write(`${saida.split(apiKey).join("***")}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
  });
}
