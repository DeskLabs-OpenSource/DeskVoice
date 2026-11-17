import type { Brain } from "@deskvoice/voice-engine/brain";
import { ApiError, handle, notFound } from "../../../../../../../server/context";
import { findBrain, readStoredModels, storedBrainKey, testBrainKey } from "../../../../../../../server/brains";

interface Target {
  brain: Brain;
  /** A chave salva, cifrada. Nunca vai na resposta. */
  stored: string;
}

/**
 * Relê a lista de modelos com a chave salva, que é também o teste dela. Com limite por cérebro e
 * organização. A releitura que falha devolve a lista guardada com `stale: true` e o motivo em código.
 */
export const POST = handle(
  {
    configure: true,
    after: async ({ brain, stored }: Target, { deps, session, org }) => {
      const test = await testBrainKey(deps, org, session.organizationId, brain, stored);
      if (!test) throw new ApiError(429, "too_many_brain_checks", "Too many model list reads for this provider. Wait a few minutes and try again.");
      if (test.saved && test.models) return { ...test.models, stale: false, check: test.check };
      const kept = await org((q) => readStoredModels(q, brain));
      return { fetchedAt: kept?.fetchedAt ?? null, models: kept?.models ?? [], stale: true, check: test.saved ? test.check : null };
    },
  },
  async ({ q, params }): Promise<Target> => {
    const brain = await findBrain(params.brain ?? "");
    if (!brain) throw notFound();
    const stored = await storedBrainKey(q, brain);
    if (!stored) throw new ApiError(409, "brain_key_missing", "This provider has no saved key. Paste the key and save it first.");
    return { brain, stored };
  },
);
