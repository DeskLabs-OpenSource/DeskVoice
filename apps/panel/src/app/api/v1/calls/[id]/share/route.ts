import { access } from "node:fs/promises";
import { SHARE_MAX_USES, SHARE_TTL_HOURS, createShareLink, liveShareLinks, recordOrgEvent, recordingPath, revokeShareLinks } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle, notFound } from "../../../../../../server/context";

// O link nasce sempre com o prazo e os usos do registro 0019. Um corpo que tente mudá-los é
// recusado, em vez de ignorado: quem pediu 30 dias fica sabendo que não terá.
const body = z.object({}).strict();

/** Os links vivos da chamada, sem o endereço (ele não é guardado), e o prazo e os usos de um link novo. */
export const GET = handle({ configure: true }, async ({ q, deps, params }) => {
  const id = params.id ?? "";
  if (!(await q.one("select 1 from calls where id = $1", [id]))) throw notFound();
  return { ttlHours: SHARE_TTL_HOURS, maxUses: SHARE_MAX_USES, links: await liveShareLinks(q, id, deps.clock.now()) };
});

/**
 * Cria o link temporário de quem ligou para UMA chamada. O endereço só aparece nesta resposta: o
 * banco guarda apenas o hash, então não há como recuperá-lo depois. Perdido o link, cria outro; o
 * antigo continua valendo até vencer, ou cai no `DELETE`.
 *
 * O endereço é montado a partir do endereço público configurado da instalação (`PUBLIC_URL`, que o
 * instalador grava), nunca do endereço pelo qual o pedido chegou.
 *
 * Sem gravação no disco não há o que entregar: 409, em vez de um link que promete áudio e devolve
 * vazio. Chamada apagada a pedido do titular também não gera link.
 */
export const POST = handle({ support: false, body, configure: true }, async ({ q, session, deps, params }) => {
  const id = params.id ?? "";
  const call = await q.one<{ id: string; erased_at: Date | null }>("select id, erased_at from calls where id = $1", [id]);
  if (!call) throw notFound();
  if (call.erased_at) throw new ApiError(409, "call_erased", "This call was erased at the caller's request: there is nothing to share.");
  const exists = await access(recordingPath(deps.recordingsDir, q.organizationId, id)).then(
    () => true,
    () => false,
  );
  if (!exists) throw new ApiError(409, "no_recording", "This call has no stored recording.");

  const now = deps.clock.now();
  const link = await createShareLink(q, { callId: id, now, createdBy: session.userId });
  await recordOrgEvent(q, "share_created", { callId: id, linkId: link.id, expiresAt: link.expiresAt.toISOString(), maxUses: link.maxUses }, now, session.userId);
  return { id: link.id, url: new URL(`/s/${link.token}`, deps.publicUrl).toString(), expiresAt: link.expiresAt, maxUses: link.maxUses };
});

/** Revoga na hora todos os links vivos da chamada. */
export const DELETE = handle({ configure: true }, async ({ q, session, deps, params }) => {
  const id = params.id ?? "";
  const now = deps.clock.now();
  const revoked = await revokeShareLinks(q, id, now);
  await recordOrgEvent(q, "share_revoked", { callId: id, revoked }, now, session.userId);
  return { revoked };
});
