/**
 * O reconhecedor lateral do Gemini Live de hoje (`inputAudioTranscription`), medido pelo motor
 * `packages/voice-engine/src/engines/gemini-live.ts`. Fontes e o que não foi confirmado estão no
 * cabeçalho do motor. Preço: o do motor (ai.google.dev/gemini-api/docs/pricing, 10/11/2026).
 *
 * Teto: estimativa do pior caso de US$ 0,03 por minuto enviado (entrada e uma resposta do modelo
 * pelo preço do motor), só para parar antes do teto. O custo escrito na tabela é o do `usage`.
 */
import { servicoDoMotor } from "./_motor-de-hoje";

export default servicoDoMotor({
  id: "gemini-hoje",
  rotulo: "Gemini Live de hoje (inputAudioTranscription)",
  carregar: async () => (await import("../../../packages/voice-engine/src/engines/gemini-live")).default,
  modelo: "gemini-3.8-live (padrão do motor)",
  variavelDaChave: "BANCADA_GEMINI_API_KEY",
  piorCasoUsdPorMinuto: 0.03,
  fontePreco: "preço do motor gemini-live (ai.google.dev/gemini-api/docs/pricing)",
  conferidoEm: "2026-11-10",
});
