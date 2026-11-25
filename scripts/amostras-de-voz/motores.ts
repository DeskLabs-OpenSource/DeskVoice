import type { MotorDasAmostras } from "./amostras";

/**
 * O modelo é o padrão de cada motor (`DEFAULT_MODEL`), o mesmo que a ligação abre: o script não
 * passa `model` ao `connect`. O nome aqui só vai para o manifesto, e `amostras.test.ts` reprova se
 * ele deixar de ser o do motor.
 */
export const MOTORES: readonly MotorDasAmostras[] = [
  {
    id: "gemini-live",
    modelo: "gemini-3.8-live",
    variavelDaChave: "AMOSTRAS_GEMINI_API_KEY",
    carregar: async () => (await import("../../packages/voice-engine/src/engines/gemini-live")).default,
  },
  {
    id: "openai-realtime",
    modelo: "gpt-realtime-2.1",
    variavelDaChave: "AMOSTRAS_OPENAI_API_KEY",
    carregar: async () => (await import("../../packages/voice-engine/src/engines/openai-realtime")).default,
  },
];
