import { access } from "node:fs/promises";
import { createShareLink, recordOrgEvent, recordingPath, revokeShareLinks } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle } from "../../../../../../server/context";

const body = z.object({
  ttlHours: z.number().int().min(1).max(24 * 30).optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
});

/**
 * Cria o link temporário do titular para UMA chamada. A URL só aparece nesta resposta: o banco
 * guarda apenas o hash, então não há como recuperá-la depois — perdido o link, cria outro (o antigo
 * continua valendo até expirar, ou cai no `DELETE`).
 *
 * Sem gravação no disco não há o que entregar: 409, em vez de um link que promete áudio e devolve
 * vazio. Chamada apagada a pedido do titular também não gera link.
 */
export const POST = handle({ body, configure: true }, async ({ q, body, session, deps, params }) => {
  const id = params.id ?? "";
  const call = await q.one<{ id: string; erased_at: Date | null }>("select id, erased_at from calls where id = $1", [id]);
  if (!call) return null;
  // Chamada apagada a pedido do titular (#170) não tem o que compartilhar.
  if (call.erased_at) throw new ApiError(409, "call_erased", "Esta chamada foi apagada a pedido do titular: não há o que compartilhar.");
  const exists = await access(recordingPath(deps.recordingsDir, q.organizationId, id)).then(() => true, () => false);
  if (!exists) throw new ApiError(409, "no_recording", "Esta chamada não tem gravação guardada.");

  const now = deps.clock.now();
  const link = await createShareLink(q, { callId: id, kind: "recording", now, createdBy: session.userId, ...body });
  await recordOrgEvent(q, "share_created", { callId: id, kind: "recording", expiresAt: link.expiresAt.toISOString(), maxUses: link.maxUses }, now, session.userId);
  return link;
});

/** Revoga na hora todos os links vivos da chamada. */
export const DELETE = handle({ configure: true }, async ({ q, session, deps, params }) => {
  const id = params.id ?? "";
  const now = deps.clock.now();
  const revoked = await revokeShareLinks(q, id, now);
  await recordOrgEvent(q, "share_revoked", { callId: id, revoked }, now, session.userId);
  return { revoked };
});
