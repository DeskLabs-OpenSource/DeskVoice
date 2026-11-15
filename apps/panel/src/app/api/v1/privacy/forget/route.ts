import { forgetCaller, recordOrgEvent } from "@deskvoice/core";
import { z } from "zod";
import { handle } from "../../../../../server/context";
import { phone } from "../../../../../server/shapes";

/**
 * "Esquecer este número" (seção 2.3 do desenho de 13/11, fatia 3b): apaga as notas do agente sobre o
 * telefone e as pendências fechadas dele, nesta organização. As abertas, as ligações e as falas ficam
 * (`forgetCaller`). Só dono ou administrador. Grava `caller_notes_deleted` com o telefone e as duas
 * contagens, como `caller_data_exported` grava o telefone, mesmo quando nada foi achado: o pedido em
 * si é um acesso ao dado.
 */
export const POST = handle({ body: z.object({ phone }), configure: true }, async ({ q, body, session, deps }) => {
  const counts = await forgetCaller(q, body.phone);
  await recordOrgEvent(q, "caller_notes_deleted", { phone: body.phone, ...counts }, deps.clock.now(), session.userId);
  return { phone: body.phone, ...counts };
});
