import { assignFollowUp } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle, notFound } from "../../../../../server/context";
import { followUpsFor, requireFollowUpAccess } from "../../../../../server/follow-ups";

/** Troca o dono de uma pendência aberta; `null` devolve à equipe. Grava `follow_up_assigned` na ligação de origem. */
export const PATCH = handle({ body: z.object({ ownerUserId: z.uuid().nullable() }) }, async ({ q, params, body, session, deps }) => {
  const id = params.id ?? "";
  await requireFollowUpAccess(q, id, session);
  const result = await assignFollowUp(q, id, body.ownerUserId, deps.clock.now());
  if (result === "not_found") throw notFound();
  if (result === "owner_unavailable") throw new ApiError(400, "owner_unavailable", "This person is not active in the team.");
  if (result === "closed") throw new ApiError(409, "follow_up_closed", "This follow-up is already closed.");
  return (await followUpsFor(q, session, "f.id = $1", [id]))[0];
});
