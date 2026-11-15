import { callerHistory } from "@deskvoice/core";
import { handle, notFound } from "../../../../../../server/context";

/**
 * O bloco "Este número" da tela da chamada: as ligações anteriores do mesmo telefone e as pendências
 * abertas dele, nesta organização (`withOrg`, pela sessão). Chamada sem número responde `phone: null`,
 * e a tela não mostra o bloco. Só leitura: nada daqui chega ao agente.
 */
export const GET = handle({}, async ({ q, params }) => {
  const id = params.id ?? "";
  if (!(await q.one("select 1 from calls where id = $1", [id]))) throw notFound();
  const history = await callerHistory(q, id);
  return history ?? { phone: null, callCount: 0, simulatedCallCount: 0, calls: [], openFollowUpCount: 0, openFollowUps: [] };
});
