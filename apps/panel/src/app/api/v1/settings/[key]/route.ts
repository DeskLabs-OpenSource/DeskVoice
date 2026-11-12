import type { VoiceEngine } from "@deskvoice/voice-engine";
import { z } from "zod";
import { ApiError, handle, type HandlerArgs } from "../../../../../server/context";
import { keyCheckSetting, testEngineKey } from "../../../../../server/engine-key";
import { settingDefinition } from "../../../../../server/settings";

async function definitionOf(args: Pick<HandlerArgs<unknown>, "params">) {
  const key = args.params.key ?? "";
  const definition = await settingDefinition(key);
  if (!definition) throw new ApiError(400, "unknown_setting", `"${key}" is not a known setting.`);
  return { key, definition };
}

export const GET = handle({}, async (args) => {
  const { key, definition } = await definitionOf(args);
  const row = await args.q.one<{ value: unknown }>("select value from settings where key = $1", [key]);
  return { key, value: row ? definition.view(row.value) : (definition.fallback ?? null) };
});

interface Saved {
  key: string;
  value: unknown;
  /** Chave de motor recém-gravada (cifrada): é testada depois da gravação, e nunca vai na resposta. */
  test?: { engine: VoiceEngine; stored: string };
}

// `value: null` apaga a configuração (é como se remove uma chave de IA).
// Chave de motor gravada é testada em seguida, fora da transação; o teste nunca impede a gravação,
// e `check: null` diz que o limite de testes adiou o teste.
export const PUT = handle(
  {
    body: z.object({ value: z.unknown() }),
    configure: true,
    after: async ({ test, ...saved }: Saved, { deps, session, org }) =>
      test ? { ...saved, check: await testEngineKey(deps, org, session.organizationId, test.engine, test.stored) } : saved,
  },
  async (args): Promise<Saved> => {
    const { key, definition } = await definitionOf(args);
    const { q, body, deps } = args;
    const previous = await q.one<{ value: unknown }>("select value from settings where key = $1", [key]);
    definition.guard?.(previous?.value ?? null);
    // O teste da chave anterior não fala da que entra (nem da ausência dela).
    if (definition.engine) await q.exec("delete from settings where key = $1", [keyCheckSetting(definition.engine.id)]);
    if (body.value === null || body.value === undefined) {
      await q.exec("delete from settings where key = $1", [key]);
      return { key, value: null };
    }
    let stored: unknown;
    try {
      stored = definition.store(body.value, deps.secretKey, previous?.value ?? null);
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      throw new ApiError(400, "validation_error", error.issues.map((issue) => `${["value", ...issue.path].join(".")}: ${issue.message}`).join("; "));
    }
    await q.exec(
      `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, $4, $5)
       on conflict (organization_id, key) do update set value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at`,
      [q.organizationId, key, JSON.stringify(stored), definition.secret, deps.clock.now()],
    );
    const test = definition.engine && typeof stored === "string" ? { engine: definition.engine, stored } : undefined;
    return { key, value: definition.view(stored), ...(test && { test }) };
  },
);
