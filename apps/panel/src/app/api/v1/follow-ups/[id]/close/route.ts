import { FOLLOW_UP_NOTE_MAX, closeFollowUp } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle, notFound } from "../../../../../../server/context";
import { followUpsFor, requireFollowUpAccess } from "../../../../../../server/follow-ups";

const body = z.object({ status: z.enum(["done", "canceled"]), note: z.string().trim().min(1).max(FOLLOW_UP_NOTE_MAX) });

/** Fecha a pendência (feita, ou cancelada com motivo). Grava `follow_up_closed` na ligação de origem, sem a nota. */
export const POST = handle({ body }, async ({ q, params, body: close, session, deps }) => {
  const id = params.id ?? "";
  await requireFollowUpAccess(q, id, session);
  const result = await closeFollowUp(q, id, { status: close.status, note: close.note, closedBy: session.userId }, deps.clock.now());
  if (result === "not_found") throw notFound();
  if (result === "already_closed") throw new ApiError(409, "follow_up_closed", "This follow-up is already closed.");
  return (await followUpsFor(q, session, "f.id = $1", [id]))[0];
});
