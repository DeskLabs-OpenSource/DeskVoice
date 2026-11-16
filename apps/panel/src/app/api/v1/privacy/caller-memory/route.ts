import { CALLER_MEMORY_AGENT_SETTING, callerMemoryAgentOf, recordOrgEvent } from "@deskvoice/core";
import { z } from "zod";
import { handle } from "../../../../../server/context";

const body = z.object({ enabled: z.boolean() }).strict();

/**
 * Liga ou desliga a memória do número no agente (decisão 4B, revista na #272; registro 0020, item 4)
 * e registra quem mudou, de quanto para quanto, sem texto livre. Desligada é a ausência da chave, como
 * vem de fábrica. Vale nas duas direções, a partir da próxima chamada: a que está em curso continua
 * como começou. Nenhum dos dois lados apaga nota: elas seguem o prazo da memória.
 */
export const PUT = handle({ body, configure: true }, async ({ q, body, session, deps }) => {
  const now = deps.clock.now();
  const stored = await q.one<{ value: unknown }>("select value from settings where key = $1", [CALLER_MEMORY_AGENT_SETTING]);
  const previous = callerMemoryAgentOf(stored?.value);
  if (previous === body.enabled) return { enabled: previous };

  if (body.enabled)
    await q.exec(
      `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, 'true', false, $3)
       on conflict (organization_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [q.organizationId, CALLER_MEMORY_AGENT_SETTING, now],
    );
  else await q.exec("delete from settings where key = $1", [CALLER_MEMORY_AGENT_SETTING]);
  await recordOrgEvent(q, "caller_memory_changed", { from: previous, to: body.enabled }, now, session.userId);
  return { enabled: body.enabled };
});
