import type { VoiceEngine } from "@deskvoice/voice-engine";
import { ApiError, handle, notFound } from "../../../../../../server/context";
import { testEngineKey } from "../../../../../../server/engine-key";
import { engineKeySetting, listEngines } from "../../../../../../server/pieces";

/** O motor e a chave salva dele, cifrada (`null` no motor que não pede chave). Nunca vai na resposta. */
interface Target {
  engine: VoiceEngine;
  stored: string | null;
}

/**
 * Testa a chave salva de um motor, sem abrir sessão de voz: só dono e administrador, e com limite
 * por motor. A resposta é o código do resultado, o modelo conferido e quando; nunca a chave.
 */
export const POST = handle(
  {
    configure: true,
    after: async ({ engine, stored }: Target, { deps, session, org }) => {
      if (stored === null) return { ...(await engine.checkKey("")), checkedAt: deps.clock.now().toISOString() };
      const check = await testEngineKey(deps, org, session.organizationId, engine, stored);
      if (!check) throw new ApiError(429, "too_many_key_checks", "Too many key tests for this engine. Wait a few minutes and test again.");
      return check;
    },
  },
  async ({ q, params }): Promise<Target> => {
    const engine = (await listEngines()).find((candidate) => candidate.id === params.engine);
    if (!engine) throw notFound();
    if (engine.keyless) return { engine, stored: null };
    const row = await q.one<{ value: unknown }>("select value from settings where key = $1", [engineKeySetting(engine.id)]);
    if (typeof row?.value !== "string") throw new ApiError(409, "engine_key_missing", "This engine has no saved key. Paste the key and save it before testing.");
    return { engine, stored: row.value };
  },
);
