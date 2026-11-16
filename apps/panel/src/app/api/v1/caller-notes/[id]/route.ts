import { deleteCallerNote, recordOrgEvent } from "@deskvoice/core";
import { handle, notFound } from "../../../../../server/context";

/**
 * Apaga uma nota do agente pelo botão "Apagar" do bloco "Este número" (fatia 3b do desenho de 13/11).
 * Quem vê o bloco apaga: dono, administrador e operador. A nota errada é dado pessoal errado, e quem
 * atende é quem a encontra; o registro da organização guarda quem apagou. O evento leva só a
 * contagem, nunca o texto nem o telefone: a nota saiu, e o registro não pode guardá-la de volta.
 */
export const DELETE = handle({}, async ({ q, session, deps, params }) => {
  if (!(await deleteCallerNote(q, params.id ?? ""))) throw notFound();
  await recordOrgEvent(q, "caller_notes_deleted", { notes: 1 }, deps.clock.now(), session.userId);
  return { notes: 1 };
});
