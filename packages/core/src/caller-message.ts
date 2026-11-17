import type { OrgQuery } from "./types";

/** Onde mora o conector de WhatsApp da organização (`settings.key`). */
export const WHATSAPP_CONNECTOR_KEY = "whatsapp.connector";
/** Ajuste da organização: `true` faz o envio para quem ligou sair sem confirmação humana. */
export const TRUST_CALLER_ID_KEY = "whatsapp.trust_caller_id";

/** Por que a mensagem para quem ligou não pode sair: falta o conector, ou a organização não confia no número de quem liga. */
export type CallerMessageBlock = "whatsapp_not_connected" | "caller_id_not_trusted";

/**
 * A mensagem no WhatsApp para quem ligou, quando a ligação cai (desenho
 * 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.5), só sai com conector e com
 * `whatsapp.trust_caller_id` ligado: depois da queda não há a quem pedir confirmação. Devolve `null`
 * quando pode sair, ou o motivo. A rota do agente confere ao escolher o modo, e a revisão de novo na
 * hora de agir, porque o ajuste pode ter sido desligado depois.
 *
 * Fica no núcleo, e não em `@deskvoice/tools`, porque a revisão (`review_call`) não importa nada que
 * chame rede: aqui são só duas leituras de `settings`.
 */
export async function callerMessageBlock(q: OrgQuery): Promise<CallerMessageBlock | null> {
  const rows = await q.many<{ key: string; value: unknown }>("select key, value from settings where organization_id = $1 and key = any($2::text[])", [
    q.organizationId,
    [WHATSAPP_CONNECTOR_KEY, TRUST_CALLER_ID_KEY],
  ]);
  const value = (key: string): unknown => rows.find((row) => row.key === key)?.value ?? null;
  if (value(WHATSAPP_CONNECTOR_KEY) === null) return "whatsapp_not_connected";
  if (value(TRUST_CALLER_ID_KEY) !== true) return "caller_id_not_trusted";
  return null;
}
