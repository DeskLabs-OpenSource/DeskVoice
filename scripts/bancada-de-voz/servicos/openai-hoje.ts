/**
 * O reconhecedor lateral do OpenAI Realtime de hoje (`gpt-4o-mini-transcribe`), medido pelo motor
 * `packages/voice-engine/src/engines/openai-realtime.ts`. Fontes e o que não foi confirmado estão
 * no cabeçalho do motor. Preço: o do motor (developers.openai.com/api/docs/pricing, 12/11/2026).
 *
 * Teto: estimativa do pior caso de US$ 0,10 por minuto enviado (entrada de áudio a US$ 32 por milhão
 * de tokens, mais uma resposta do modelo a US$ 64 por milhão), só para parar antes do teto. O custo
 * escrito na tabela é o do `usage` que o provedor devolve.
 */
import { servicoDoMotor } from "./_motor-de-hoje";

export default servicoDoMotor({
  id: "openai-hoje",
  rotulo: "OpenAI Realtime de hoje (gpt-4o-mini-transcribe lateral)",
  carregar: async () => (await import("../../../packages/voice-engine/src/engines/openai-realtime")).default,
  modelo: "gpt-realtime-2.1 + gpt-4o-mini-transcribe (padrão do motor)",
  variavelDaChave: "BANCADA_OPENAI_API_KEY",
  piorCasoUsdPorMinuto: 0.1,
  fontePreco: "preço do motor openai-realtime (developers.openai.com/api/docs/pricing)",
  conferidoEm: "2026-11-12",
});
