import { CALL_RECORDING_SETTING, callRecordingOf, recordOrgEvent } from "@deskvoice/core";
import { z } from "zod";
import { handle } from "../../../../../server/context";

const body = z.object({ enabled: z.boolean() });

/**
 * Liga ou desliga a gravação do áudio das chamadas da organização (registro 0016) e registra quem
 * mudou. Desligada é a ausência da chave, como vem de fábrica. Nenhum dos dois lados apaga
 * arquivo: o que já foi gravado segue o prazo de guarda das conversas. Vale a partir da próxima
 * chamada; a que está em curso continua como começou.
 */
export const PUT = handle({ body, configure: true }, async ({ q, body, session, deps }) => {
  const now = deps.clock.now();
  const stored = await q.one<{ value: unknown }>("select value from settings where key = $1", [CALL_RECORDING_SETTING]);
  const previous = callRecordingOf(stored?.value);
  if (previous === body.enabled) return { enabled: previous };

  if (body.enabled)
    await q.exec(
      `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, 'true', false, $3)
       on conflict (organization_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [q.organizationId, CALL_RECORDING_SETTING, now],
    );
  else await q.exec("delete from settings where key = $1", [CALL_RECORDING_SETTING]);
  await recordOrgEvent(q, "call_recording_changed", { from: previous, to: body.enabled }, now, session.userId);
  return { enabled: body.enabled };
});
