import { z } from "zod";

/**
 * Quem lê a ligação de um agente (o desfecho e a análise depois que ela termina), gravado em
 * `agents.analysis_brain`. Nula é "segue a organização" (`calls.analysis_brain`). `engine` é o motor
 * do próprio agente, mesmo com um cérebro escolhido na organização; `brain` é um cérebro e um modelo
 * da lista guardada dele. Validada na escrita (painel) e na leitura (rotina): fora da forma, a ligação
 * não é lida, e nunca cai na escolha da organização nem no motor.
 */
export const agentAnalysisBrain = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("engine") }).strict(),
  z.object({ kind: z.literal("brain"), brain: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(300) }).strict(),
]);
export type AgentAnalysisBrain = z.infer<typeof agentAnalysisBrain>;
