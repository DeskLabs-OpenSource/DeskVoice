import type { Brain } from "@deskvoice/voice-engine/brain";
import { handle, notFound } from "../../../../../../server/context";
import { findBrain, isStale, readStoredModels, storedBrainKey, testBrainKey, type StoredBrainModels } from "../../../../../../server/brains";

interface Stored {
  brain: Brain;
  key: string | null;
  models: StoredBrainModels | null;
}

/**
 * A lista de modelos guardada. A que passou de 24 horas é relida antes de responder, contando no limite
 * de leituras; se a releitura não der (limite, provedor fora, chave recusada), vem a guardada com
 * `stale: true`.
 */
export const GET = handle(
  {
    configure: true,
    after: async ({ brain, key, models }: Stored, { deps, session, org }) => {
      if (!models) return { fetchedAt: null, models: [], stale: false };
      if (!key || !isStale(models, deps.clock.now())) return { ...models, stale: false };
      const test = await testBrainKey(deps, org, session.organizationId, brain, key);
      if (test?.saved && test.models) return { ...test.models, stale: false };
      return { ...models, stale: true };
    },
  },
  async ({ q, params }): Promise<Stored> => {
    const brain = await findBrain(params.brain ?? "");
    if (!brain) throw notFound();
    return { brain, key: await storedBrainKey(q, brain), models: await readStoredModels(q, brain) };
  },
);
