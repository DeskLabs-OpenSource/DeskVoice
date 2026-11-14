/**
 * Base dos serviços "de hoje": mede o reconhecedor lateral do motor direto **pelo próprio motor**
 * de `packages/voice-engine`, com a mesma mensagem de abertura e o mesmo caminho de áudio da ligação
 * (8 kHz; no OpenAI, o motor passa por μ-law sozinho). É a medida mais fiel do que roda hoje.
 *
 * - final: o `transcript` de quem ligou (o motor só o entrega quando o turno fecha);
 * - parcial: o primeiro `callerActivity({ words: true })` (o motor avisa que há texto, sem o texto).
 *
 * A linha larga não é medida aqui: o contrato do motor é `pcm16_8k`. Medi-la pede uma conexão
 * direta ao serviço de transcrição, fora do motor, e fica para quando a chave chegar.
 *
 * A chave vem de uma variável **própria da bancada** (`BANCADA_*_API_KEY`), entregue por canal
 * privado (decisão 2 da DESA-19). Nunca a de outro programa da máquina, e nunca em arquivo do repositório.
 *
 * O arquivo começa com "_": não é um serviço, e a descoberta da pasta o pula.
 */
import type { EnginePricing, Usage, VoiceEngine } from "../../../packages/voice-engine/src/types";
import type { Linha } from "../linhas";
import type { ServicoMedido } from "./tipos";

/** Custo sem arredondar (o `estimateCostCents` do produto arredonda cada chamada para cima, em centavos). */
export function custoEmDolares(preco: EnginePricing, uso: Usage): number {
  const centavos =
    ((uso.seconds ?? 0) / 60) * (preco.centsPerMinute ?? 0) +
    ((uso.inputTokens ?? 0) / 1e6) * (preco.centsPerMillionInputTokens ?? 0) +
    ((uso.outputTokens ?? 0) / 1e6) * (preco.centsPerMillionOutputTokens ?? 0) +
    ((uso.textInputTokens ?? 0) / 1e6) * (preco.centsPerMillionTextInputTokens ?? preco.centsPerMillionInputTokens ?? 0) +
    ((uso.cachedInputTokens ?? 0) / 1e6) * (preco.centsPerMillionCachedInputTokens ?? preco.centsPerMillionInputTokens ?? 0) +
    ((uso.textOutputTokens ?? 0) / 1e6) * (preco.centsPerMillionTextOutputTokens ?? preco.centsPerMillionOutputTokens ?? 0);
  return centavos / 100;
}

const INSTRUCOES = "Você está numa medida de reconhecimento de fala. Não responda nada e não fale: apenas ouça.";

export function servicoDoMotor(opcoes: {
  id: string;
  rotulo: string;
  carregar: () => Promise<VoiceEngine>;
  modelo: string;
  variavelDaChave: string;
  /** Estimativa do pior caso por minuto de áudio enviado (entrada + uma resposta do modelo), só para o teto. */
  piorCasoUsdPorMinuto: number;
  fontePreco: string;
  conferidoEm: string;
}): ServicoMedido {
  return {
    id: opcoes.id,
    rotulo: opcoes.rotulo,
    modelo: opcoes.modelo,
    preco: { usdPorMinuto: opcoes.piorCasoUsdPorMinuto, fonte: opcoes.fontePreco, conferidoEm: opcoes.conferidoEm },
    entrega: (linha: Linha) => (linha === "estreita" ? { taxaHz: 8000, mulaw: false } : null),
    indisponivel: () => (process.env[opcoes.variavelDaChave] ? null : `sem chave (${opcoes.variavelDaChave}): a chave da DESA-10 não chegou`),
    async abrir(config, _linha, eventos, relogio) {
      const motor = await opcoes.carregar();
      const sessao = await motor.connect(
        { instructions: INSTRUCOES, language: config.idioma, tools: [], vocabulary: config.vocabulario },
        process.env[opcoes.variavelDaChave] ?? "",
      );
      let custo = 0;
      sessao.on("usage", (uso) => (custo += custoEmDolares(motor.pricing, uso)));
      sessao.on("callerActivity", ({ words }) => words && eventos.parcial("", relogio.agora()));
      sessao.on("transcript", ({ speaker, text }) => speaker === "user" && eventos.final(text, relogio.agora()));
      sessao.on("error", (erro) => eventos.erro(erro));
      return {
        enviar: (pcm16) => sessao.sendAudio(pcm16),
        fechar: async () => {
          await sessao.close();
          return { custoUsd: custo };
        },
      };
    },
  };
}
