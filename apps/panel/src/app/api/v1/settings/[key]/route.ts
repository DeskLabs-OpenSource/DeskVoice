import { z } from "zod";
import { ApiError, handle, type HandlerArgs } from "../../../../../server/context";
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

// `value: null` apaga a configuração (é como se remove uma chave de IA).
export const PUT = handle({ body: z.object({ value: z.unknown() }), configure: true }, async (args) => {
  const { key, definition } = await definitionOf(args);
  const { q, body, deps } = args;
  if (body.value === null || body.value === undefined) {
    await q.exec("delete from settings where key = $1", [key]);
    return { key, value: null };
  }
  const previous = await q.one<{ value: unknown }>("select value from settings where key = $1", [key]);
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
  return { key, value: definition.view(stored) };
});
