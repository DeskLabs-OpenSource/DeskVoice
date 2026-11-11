import { withOrg, withSystem, type OrgQuery } from "@deskvoice/core";
import type { Routine } from "../types";

export const EXPIRE_APPROVALS_INTERVAL_MS = 30_000;

/**
 * Garante que a organização tem uma (e só uma) tarefa `expire_approvals` na fila. A trava de
 * transação fecha a corrida entre dois processos que conferem ao mesmo tempo.
 */
export async function ensureExpireApprovals(q: OrgQuery, organizationId: string, runAt: Date): Promise<void> {
  await q.one("select pg_advisory_xact_lock(hashtext($1))", [`expire_approvals:${organizationId}`]);
  await q.exec(
    `insert into tasks (organization_id, kind, run_at)
     select $1, 'expire_approvals', $2
      where not exists (select 1 from tasks where organization_id = $1 and kind = 'expire_approvals' and status = 'queued')`,
    [organizationId, runAt],
  );
}

/**
 * Aprovação pendente que passou do prazo vira `expired`. A chamada em espera acorda pelo aviso
 * do canal `approvals` e é a ferramenta `request_approval` que aplica o `default_on_timeout`.
 * Recorrente: cada execução deixa a próxima agendada.
 */
const routine: Routine = {
  kind: "expire_approvals",
  async run(task, deps) {
    const now = deps.clock.now();
    await withOrg(deps.db, task.organizationId, async (q) => {
      await q.exec("update approvals set status = 'expired', decided_at = $1 where status = 'pending' and expires_at <= $1", [now]);
      await ensureExpireApprovals(q, task.organizationId, new Date(now.getTime() + EXPIRE_APPROVALS_INTERVAL_MS));
    });
  },
  // Religa a corrente de toda organização na partida: cobre a que nasceu antes desta rotina e a
  // que perdeu a tarefa por esgotar as tentativas.
  async seed(deps) {
    await withSystem(deps.db, async (q) => {
      for (const { id } of await q.many<{ id: string }>("select id from organizations order by id")) {
        await ensureExpireApprovals(q, id, deps.clock.now());
      }
    });
  },
};

export default routine;
