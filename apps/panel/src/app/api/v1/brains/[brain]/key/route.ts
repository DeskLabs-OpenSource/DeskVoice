import type { Brain } from "@deskvoice/voice-engine/brain";
import { z } from "zod";
import { handle, notFound } from "../../../../../../server/context";
import { findBrain, removeBrainKey, saveBrainKey, testBrainKey } from "../../../../../../server/brains";

interface Saved {
  brain: Brain;
  /** A chave recém-gravada, cifrada: é testada depois da gravação e nunca vai na resposta. */
  stored: string;
}

async function brainOf(params: Record<string, string>): Promise<Brain> {
  const brain = await findBrain(params.brain ?? "");
  if (!brain) throw notFound();
  return brain;
}

/**
 * Grava a chave de um cérebro e a testa em seguida, lendo a lista de modelos fora da transação. O teste
 * nunca impede a gravação; `check: null` diz que o limite de leituras adiou o teste.
 */
export const PUT = handle(
  {
    body: z.object({ apiKey: z.string().trim().min(1).max(500) }),
    configure: true,
    after: async ({ brain, stored }: Saved, { deps, session, org }) => {
      const test = await testBrainKey(deps, org, session.organizationId, brain, stored);
      // Trocada de novo durante o teste: o resultado não fala da chave em vigor.
      const current = test?.saved ? test : null;
      return { configured: true, check: current?.check ?? null, modelCount: current?.models?.models.length ?? null };
    },
  },
  async ({ q, params, body, deps }): Promise<Saved> => {
    const brain = await brainOf(params);
    return { brain, stored: await saveBrainKey(q, deps, brain, body.apiKey) };
  },
);

/** Remove a chave, o último teste e a lista de modelos do cérebro. */
export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  const brain = await brainOf(params);
  await removeBrainKey(q, brain);
  return { configured: false };
});
