import type { DecisionModel } from "@deskvoice/voice-engine/types";
import { z } from "zod";
import { handle } from "../../../../../../server/context";
import { keyedModel, removeDecisionModelKey, saveDecisionModelKey, testDecisionModelKey } from "../../store";

interface Saved {
  model: DecisionModel;
  /** A chave recém-gravada, cifrada: é testada depois da gravação e nunca vai na resposta. */
  stored: string;
}

/**
 * Grava a chave do modelo de decisão, cifrada, e a testa em seguida pelo `checkKey` dele, fora da
 * transação. O teste nunca impede a gravação; `check: null` diz que o limite de testes o adiou.
 */
export const PUT = handle(
  {
    body: z.object({ apiKey: z.string().trim().min(1).max(500) }),
    configure: true,
    after: async ({ model, stored }: Saved, { deps, session, org }) => ({ configured: true, check: await testDecisionModelKey(deps, org, session.organizationId, model, stored) }),
  },
  async ({ q, params, body, deps }): Promise<Saved> => {
    const model = await keyedModel(params.model ?? "");
    return { model, stored: await saveDecisionModelKey(q, deps, model, body.apiKey) };
  },
);

/** Remove a chave e o último teste. Recusa enquanto o modelo estiver ligado. */
export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  await removeDecisionModelKey(q, await keyedModel(params.model ?? ""));
  return { configured: false };
});
