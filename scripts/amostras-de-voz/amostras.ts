/**
 * As amostras de voz do botão "Ouvir" (DESA-397, fatia 1b): cada voz de cada motor diz uma frase
 * fixa por idioma, **pelo próprio motor** de `packages/voice-engine`, o mesmo modelo e o mesmo
 * caminho de áudio da ligação (PCM16 a 8 kHz, a linha telefônica). Não é o modelo de TTS.
 *
 * Script manual, fora do CI e da imagem. Quem roda é o Rafael, no Mac dele, com a chave dele
 * (`scripts/amostras-de-voz/README.md`). Aqui fica só a lógica, testada sem rede e sem chave
 * (`amostras.test.ts`, com um motor falso); `gerar.ts` liga às peças de verdade.
 *
 * - **Teto.** `--teto-usd` é obrigatório e vai de 0 a 2. Antes de cada pedido, o pior caso dele é
 *   reservado (`Orcamento` da bancada); se não cabe, o script para ali, antes de gastar, e diz o que
 *   ficou de fora. A reserva vira o custo do `usage` ao fechar. Se o custo real passar do pior caso,
 *   o pior caso deixou de valer e nenhum pedido novo sai.
 * - **Chave.** Só `AMOSTRAS_OPENAI_API_KEY` e `AMOSTRAS_GEMINI_API_KEY`. Provedor sem chave sai como
 *   "não gerado: chave não entregue", sem abrir sessão. Toda linha impressa e todo texto gravado no
 *   manifesto passa por `semAsChaves` (a mesma da bancada).
 * - **Divergente.** O texto que o motor de fato falou (a transcrição da fala do agente) é comparado
 *   com a frase pedida. Se foge dela, o arquivo é gravado com `.divergente.mp3`, para ouvir, e fica
 *   fora do mapa de `sample`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConnectOptions, Usage, VoiceEngine, VoiceSession } from "../../packages/voice-engine/src/types";
import { Orcamento, type Reserva } from "../bancada-de-voz/orcamento";
import { semAsChaves } from "../bancada-de-voz/rodada";
import { custoEmDolares } from "../bancada-de-voz/servicos/_motor-de-hoje";

/** O maior teto que o script aceita (decisão da DESA-398). */
export const TETO_MAXIMO_USD = 2;

export const IDIOMAS = ["pt-BR", "en", "es"] as const;
export type Idioma = (typeof IDIOMAS)[number];

/** A frase fixa de cada idioma. */
export const FRASES: Record<Idioma, string> = {
  "pt-BR": "Olá, aqui é a assistente da sua empresa. Como posso ajudar?",
  en: "Hi, this is your company's assistant. How can I help?",
  es: "Hola, soy la asistente de tu empresa. ¿En qué puedo ayudarte?",
};

/** O `language` da sessão de cada idioma: o motor pede a fala "in <language>". */
export const IDIOMA_DA_SESSAO: Record<Idioma, string> = { "pt-BR": "pt-BR", en: "en-US", es: "es-MX" };

/** As instruções da sessão. A fala vem de `say`, o mesmo pedido de fala literal da ligação. */
export const INSTRUCOES = "You are recording a voice sample for a phone assistant. Say only what you are asked to say, exactly, and nothing else.";

const BYTES_POR_SEGUNDO = 8000 * 2;
/** Mais fala que isto é o motor falando outra coisa: a sessão fecha e o item sai como `cortado`. */
export const MAXIMO_DE_FALA_S = 20;
/** Prazo para a fala inteira (o texto do agente) chegar, contado do pedido. */
export const PRAZO_DA_FALA_MS = 30_000;
/** Depois do texto, quanto se espera pelo `usage` da resposta (o custo). */
export const PRAZO_DO_USO_MS = 5_000;

/**
 * O pior caso de um pedido, em tokens, para o teto. A fala tem uns 4 s, e o corte é em
 * `MAXIMO_DE_FALA_S`. Supõe 100 tokens de áudio por segundo de fala, mais que o dobro do que os
 * dois provedores documentam (não conferido contra a fatura: veja "Não medido" no README); a entrada
 * inteira cobrada como áudio, que é o preço maior; e uma folga de texto na saída.
 */
export const PIOR_CASO_POR_PEDIDO: Usage = {
  outputTokens: MAXIMO_DE_FALA_S * 100,
  inputTokens: 2_000,
  textOutputTokens: 1_000,
};

export interface MotorDasAmostras {
  /** O `id` do motor (`openai-realtime`, `gemini-live`): a pasta das amostras. */
  id: string;
  /** O modelo de voz em tempo real que `connect` abre sem `model` (o padrão do motor). */
  modelo: string;
  variavelDaChave: string;
  carregar(): Promise<VoiceEngine>;
  /** Só nos testes: o endereço de um provedor falso. Nunca `model`: a amostra é do modelo da ligação. */
  baseUrl?: string;
}

export interface Pecas {
  motores: readonly MotorDasAmostras[];
  /** Grava o PCM16 mono de 8 kHz em MP3 mono no destino. */
  codificar(pcm16_8k: Buffer, destino: string): Promise<void>;
  /** Confere o codificador antes de qualquer pedido pago: o motivo, se não dá; nulo, se dá. */
  conferirCodificador(): Promise<string | null>;
  esperar(ms: number): Promise<void>;
  agora(): Date;
  saida(linha: string): void;
  ambiente: NodeJS.ProcessEnv;
  /** A pasta padrão de `--saida`: `apps/panel/public/voice-samples` do repositório. */
  saidaPadrao: string;
}

export type Situacao = "ok" | "divergente" | "cortado" | "sem fala" | "falhou";

export interface EntradaDoManifesto {
  /** Relativo à pasta de saída: `<motor>/<voz>.<idioma>.mp3` (ou `.divergente.mp3`). Ausente sem áudio. */
  arquivo?: string;
  motor: string;
  voz: string;
  idioma: Idioma;
  modelo: string;
  data: string;
  frase: string;
  /** O texto que o motor de fato falou (a transcrição da fala do agente que o provedor devolve). */
  falado: string;
  situacao: Situacao;
  custoUsd: number;
  /** O provedor não devolveu `usage` a tempo: o custo é o pior caso reservado. */
  custoEstimado: boolean;
  erro?: string;
}

export interface Manifesto {
  script: string;
  amostras: EntradaDoManifesto[];
}

/** Minúsculas, sem acento, sem pontuação e com um espaço entre palavras: o que conta é a fala. */
export function normalizarFala(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const falouAFrase = (falado: string, frase: string): boolean => normalizarFala(falado) === normalizarFala(frase);

function argumento(argv: readonly string[], nome: string): string | undefined {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function lista(argv: readonly string[], nome: string): string[] | undefined {
  const valor = argumento(argv, nome);
  return valor === undefined ? undefined : valor.split(",").map((parte) => parte.trim()).filter(Boolean);
}

/** O teto pedido, ou o erro que o script imprime antes de tudo. */
export function lerTeto(argv: readonly string[]): number | string {
  const texto = argumento(argv, "teto-usd");
  if (texto === undefined) return `--teto-usd é obrigatório (no máximo ${TETO_MAXIMO_USD})`;
  const teto = Number(texto);
  if (!Number.isFinite(teto) || teto < 0 || teto > TETO_MAXIMO_USD) return `--teto-usd vai de 0 a ${TETO_MAXIMO_USD} (recebeu ${texto})`;
  return teto;
}

const nomeDoArquivo = (motor: string, voz: string, idioma: Idioma, situacao: Situacao): string =>
  `${motor}/${voz}.${idioma}${situacao === "ok" ? "" : ".divergente"}.mp3`;

const chave = (entrada: Pick<EntradaDoManifesto, "motor" | "voz" | "idioma">): string => `${entrada.motor}/${entrada.voz}/${entrada.idioma}`;

/** Uma voz num idioma: abre a sessão, pede a frase e junta o áudio, o texto falado e o custo. */
async function falar(
  motor: VoiceEngine,
  opcoes: ConnectOptions,
  chaveDaApi: string,
  voz: string,
  idioma: Idioma,
  pecas: Pecas,
): Promise<{ audio: Buffer; falado: string; custoUsd: number; comUso: boolean; situacao: Situacao; erro?: string }> {
  const pedacos: Buffer[] = [];
  let bytes = 0;
  const textos: string[] = [];
  let custoUsd = 0;
  let comUso = false;
  let erro: string | undefined;
  let sessao: VoiceSession | undefined;
  let fim!: (situacao: Situacao | null) => void;
  const acabou = new Promise<Situacao | null>((resolve) => (fim = resolve));
  let chegouUso!: () => void;
  const usoChegou = new Promise<void>((resolve) => (chegouUso = resolve));
  try {
    sessao = await motor.connect({ instructions: INSTRUCOES, language: IDIOMA_DA_SESSAO[idioma], tools: [], voiceId: voz }, chaveDaApi, opcoes);
    sessao.on("audio", (pcm) => {
      pedacos.push(pcm);
      bytes += pcm.length;
      if (bytes > MAXIMO_DE_FALA_S * BYTES_POR_SEGUNDO) fim("cortado");
    });
    sessao.on("transcript", ({ speaker, text }) => {
      if (speaker !== "agent") return;
      textos.push(text);
      fim(null);
    });
    sessao.on("usage", (uso) => {
      custoUsd += custoEmDolares(motor.pricing, uso);
      comUso = true;
      chegouUso();
    });
    sessao.on("error", (falha) => (erro ??= falha.message));
    sessao.on("closed", () => fim("falhou"));
    sessao.say(FRASES[idioma]);
    const parada = await Promise.race([acabou, pecas.esperar(PRAZO_DA_FALA_MS).then(() => "sem fala" as const)]);
    if (parada === null) {
      // O texto chegou: espera o `usage` da resposta, e um pouco mais, para o custo entrar inteiro.
      if (!comUso) await Promise.race([usoChegou, pecas.esperar(PRAZO_DO_USO_MS)]);
      await pecas.esperar(500);
    }
    const falado = textos.join(" ").trim();
    const situacao: Situacao = parada ?? (falouAFrase(falado, FRASES[idioma]) ? "ok" : "divergente");
    return { audio: Buffer.concat(pedacos), falado, custoUsd, comUso, situacao, ...(erro ? { erro } : {}) };
  } catch (falha) {
    return { audio: Buffer.concat(pedacos), falado: textos.join(" ").trim(), custoUsd, comUso, situacao: "falhou", erro: (falha as Error).message };
  } finally {
    await sessao?.close().catch(() => undefined);
  }
}

/** O trecho de `sample` de cada motor, para a fatia 1c colar nas vozes do motor. */
export function trechoDeSample(manifesto: Manifesto): string[] {
  const linhas: string[] = [];
  const motores = [...new Set(manifesto.amostras.map((a) => a.motor))];
  for (const motor of motores) {
    const porVoz = new Map<string, Partial<Record<Idioma, string>>>();
    for (const a of manifesto.amostras) {
      if (a.motor !== motor || a.situacao !== "ok" || !a.arquivo) continue;
      porVoz.set(a.voz, { ...porVoz.get(a.voz), [a.idioma]: `voice-samples/${a.arquivo}` });
    }
    linhas.push(`// ${motor}: ${porVoz.size} voz(es) com amostra`);
    for (const [voz, sample] of porVoz) {
      const partes = IDIOMAS.filter((idioma) => sample[idioma]).map((idioma) => `${idioma === "pt-BR" ? '"pt-BR"' : idioma}: "${sample[idioma]}"`);
      linhas.push(`{ id: "${voz}", sample: { ${partes.join(", ")} } },`);
    }
  }
  return linhas;
}

async function lerManifesto(caminho: string): Promise<Manifesto> {
  try {
    const lido = JSON.parse(await readFile(caminho, "utf8")) as Manifesto;
    return { script: lido.script, amostras: Array.isArray(lido.amostras) ? lido.amostras : [] };
  } catch {
    return { script: "scripts/amostras-de-voz/gerar.ts", amostras: [] };
  }
}

/** A rodada inteira. Devolve o código de saída. */
export async function gerarAmostras(argv: readonly string[], pecas: Pecas): Promise<number> {
  const print = (linha = ""): void => pecas.saida(semAsChaves(linha, pecas.ambiente));
  const teto = lerTeto(argv);
  if (typeof teto === "string") {
    print(teto);
    return 2;
  }
  const saida = argumento(argv, "saida") ?? pecas.saidaPadrao;
  const motoresPedidos = lista(argv, "motores");
  const vozesPedidas = lista(argv, "vozes");
  const motores = pecas.motores.filter((m) => !motoresPedidos || motoresPedidos.includes(m.id));
  const desconhecidos = (motoresPedidos ?? []).filter((id) => !pecas.motores.some((m) => m.id === id));
  if (desconhecidos.length > 0) {
    print(`motor desconhecido: ${desconhecidos.join(", ")} (há ${pecas.motores.map((m) => m.id).join(", ")})`);
    return 2;
  }

  const orcamento = new Orcamento(teto);
  const caminhoDoManifesto = join(saida, "manifesto.json");
  const manifesto = await lerManifesto(caminhoDoManifesto);
  const naoGerados: string[] = [];
  const foraDoTeto: string[] = [];
  let codificadorConferido = false;

  print(`Amostras de voz — teto US$ ${teto.toFixed(2)}, saída ${saida}`);
  for (const m of motores) {
    const chaveDaApi = pecas.ambiente[m.variavelDaChave];
    if (!chaveDaApi) {
      naoGerados.push(`${m.id}: não gerado: chave não entregue (${m.variavelDaChave})`);
      continue;
    }
    const motor = await m.carregar();
    const vozes = (motor.voices ?? []).map((v) => v.id).filter((id) => !vozesPedidas || vozesPedidas.includes(id));
    const piorCaso = custoEmDolares(motor.pricing, PIOR_CASO_POR_PEDIDO);
    print(`${m.id} (${m.modelo}): ${vozes.length} voz(es) × ${IDIOMAS.length} idiomas, pior caso US$ ${piorCaso.toFixed(4)} por pedido`);
    for (const voz of vozes) {
      for (const idioma of IDIOMAS) {
        const item = `${m.id}/${voz}.${idioma}`;
        if (foraDoTeto.length > 0) {
          foraDoTeto.push(item);
          continue;
        }
        if (!codificadorConferido) {
          // Antes do primeiro pedido pago: sem codificador, o gasto viraria áudio jogado fora.
          const motivo = await pecas.conferirCodificador();
          if (motivo) {
            print(`sem codificador de MP3: ${motivo}. Nada foi pedido.`);
            return 1;
          }
          codificadorConferido = true;
        }
        const reserva: Reserva | null = orcamento.reservar(piorCaso, m.id);
        if (!reserva) {
          print(`${item}: ${orcamento.motivoDaParada()}, antes de pedir`);
          foraDoTeto.push(item);
          continue;
        }
        const fala = await falar(motor, m.baseUrl ? { baseUrl: m.baseUrl } : {}, chaveDaApi, voz, idioma, pecas);
        // Sem `usage`, o custo é o pior caso reservado: nunca menos do que pode ter custado.
        const custoUsd = fala.comUso ? fala.custoUsd : piorCaso;
        reserva.fechar(custoUsd);
        let arquivo = fala.audio.length > 0 ? nomeDoArquivo(m.id, voz, idioma, fala.situacao) : undefined;
        if (arquivo) {
          const destino = join(saida, arquivo);
          try {
            await mkdir(dirname(destino), { recursive: true });
            await pecas.codificar(fala.audio, destino);
          } catch (falha) {
            // O pedido já foi pago: o item fica no manifesto como falhou, sem arquivo, e a rodada segue.
            arquivo = undefined;
            fala.situacao = "falhou";
            fala.erro = `MP3 não gravado: ${(falha as Error).message}`;
          }
        }
        const entrada: EntradaDoManifesto = {
          ...(arquivo ? { arquivo } : {}),
          motor: m.id,
          voz,
          idioma,
          modelo: m.modelo,
          data: pecas.agora().toISOString(),
          frase: FRASES[idioma],
          falado: semAsChaves(fala.falado, pecas.ambiente),
          situacao: fala.situacao,
          custoUsd,
          custoEstimado: !fala.comUso,
          ...(fala.erro ? { erro: semAsChaves(fala.erro, pecas.ambiente) } : {}),
        };
        manifesto.amostras = [...manifesto.amostras.filter((a) => chave(a) !== chave(entrada)), entrada];
        print(`${item}: ${fala.situacao}, US$ ${custoUsd.toFixed(4)}${entrada.custoEstimado ? " (estimado: sem usage)" : ""}${fala.situacao === "ok" ? "" : ` — falou: "${entrada.falado}"`}${entrada.erro ? ` — erro: ${entrada.erro}` : ""}`);
      }
    }
  }

  if (manifesto.amostras.length > 0 || motores.some((m) => pecas.ambiente[m.variavelDaChave])) {
    await mkdir(saida, { recursive: true });
    await writeFile(caminhoDoManifesto, `${JSON.stringify(manifesto, null, 2)}\n`);
  }

  print();
  for (const linha of naoGerados) print(linha);
  if (foraDoTeto.length > 0) print(`Fora do teto (${foraDoTeto.length}, não pedidos): ${foraDoTeto.join(", ")}`);
  print(`Gasto total: US$ ${orcamento.gasto.toFixed(4)} de US$ ${teto.toFixed(2)}`);
  for (const [servico, gasto] of orcamento.porServico()) print(`  ${servico}: US$ ${gasto.toFixed(4)}`);
  if (orcamento.excesso > 0) print(`O custo real passou do pior caso em US$ ${orcamento.excesso.toFixed(6)}: revise PIOR_CASO_POR_PEDIDO.`);
  print();
  print("Trecho de `sample` (só as amostras ok do manifesto; as divergentes ficam de fora):");
  for (const linha of trechoDeSample(manifesto)) print(linha);
  return 0;
}
