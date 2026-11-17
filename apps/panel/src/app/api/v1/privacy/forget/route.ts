import { forgetCaller, recordOrgEvent } from "@deskvoice/core";
import { z } from "zod";
import { handle } from "../../../../../server/context";
import { phone } from "../../../../../server/shapes";

/**
 * "Esquecer este número" (seção 2.3 do desenho de 13/11, fatia 3b): apaga as notas do agente sobre o
 * telefone e as pendências fechadas dele, nesta organização. As abertas, as ligações e as falas ficam
 * (`forgetCaller`). Só dono ou administrador. Grava `caller_notes_deleted` com as duas contagens e
 * só os quatro últimos dígitos do telefone, como o apagamento a pedido de quem ligou: o registro mora
 * em `organization_events`, que não tem prazo, e não pode ser o lugar onde o número esquecido fica
 * para sempre. Grava mesmo quando nada foi achado, porque o pedido em si é um acesso ao dado.
 */
export const POST = handle({ body: z.object({ phone }), configure: true }, async ({ q, body, session, deps }) => {
  const counts = await forgetCaller(q, body.phone);
  await recordOrgEvent(q, "caller_notes_deleted", { ...counts, phoneSuffix: body.phone.slice(-4) }, deps.clock.now(), session.userId);
  return { phone: body.phone, ...counts };
});
