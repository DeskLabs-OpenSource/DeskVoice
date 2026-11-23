import { recordOrgEvent } from "./events";
import { ORGANIZATION_STATE_LOCK_SQL, SUSPENSION_REASON_MAX, SUSPENSION_REASON_MIN, recordInstallationEvent } from "./installation";
import { KEEPS_RUNNING_WHEN_SUSPENDED, TASK_CANCELED_BY_SUSPENSION } from "./queue";
import type { Db, OrgQuery } from "./types";
import { withOrg, withSystem } from "./with-org";

/**
 * A organização suspensa (seção 3.3 do desenho do R8,
 * `docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md`): enquanto
 * `suspended_at` estiver marcado, nada dela atende, liga ou roda. As linhas continuam registradas,
 * para quem liga ouvir a fala de indisponível, e não o erro da operadora.
 *
 * O código de recusa é um só em todo caminho: a chamada recusada, a saída e as rotas do painel.
 */
export const ORGANIZATION_SUSPENDED = "organization_suspended";

/**
 * A organização da transação está suspensa? Lê pela própria organização (`withOrg`), e não
 * atravessando outras. Organização que não existe mais conta como não suspensa: quem chama já
 * achou a organização por outro caminho, e a ausência dela é outro erro, de quem chama.
 */
export async function organizationSuspended(q: OrgQuery): Promise<boolean> {
  const row = await q.one<{ suspended: boolean }>("select suspended_at is not null as suspended from organizations where id = $1", [q.organizationId]);
  return row?.suspended ?? false;
}

// Cancela as tarefas `queued` da organização da transação que a suspensão cancela. `$1` são os
// tipos que continuam rodando, `$2` o motivo. A RLS prende o `update` à organização de `withOrg`.
const CANCEL_QUEUED_SQL = "update tasks set status = 'canceled', last_error = $2 where status = 'queued' and not (kind = any($1::text[]))";

export type SuspendOrganizationResult =
  | { ok: true; canceledTasks: number }
  | { ok: false; reason: "invalid_reason" | "own_organization" | "not_found" | "already_suspended" | "last_active_organization" };

export type ReactivateOrganizationResult = { ok: true; canceledTasks: number } | { ok: false; reason: "not_found" | "not_suspended" | "deleting" };

/**
 * Suspende uma organização (seção 3.3 do desenho do R8), numa transação só, por `withOrg` dela:
 * - marca `suspended_at` e `suspended_reason`;
 * - cancela as tarefas `queued` canceláveis (`TASK_KIND_ON_SUSPENSION`), com `status = 'canceled'`
 *   e `last_error = 'organization_suspended'`. As rotinas de guarda, de apagamento e de vencimento
 *   de pedidos continuam `queued` e rodam;
 * - grava `organization_suspended` em `organization_events`, com o motivo e a contagem.
 *
 * A auditoria da instalação só se grava pelo papel de sistema, em outra conexão, como no convite do
 * primeiro dono: ela confirma antes da suspensão, e se falhar a suspensão é desfeita.
 *
 * Recusa o motivo fora de 10 a 500 caracteres, a organização em que quem pede está agora
 * (`sessionOrganizationId`), a organização já suspensa e a que deixaria a instalação sem nenhuma
 * organização ativa. Quem confere o papel da instalação é a rota.
 */
export async function suspendOrganization(
  db: Db,
  input: { organizationId: string; actorAccountId: string; sessionOrganizationId: string; reason: string },
  now: Date,
): Promise<SuspendOrganizationResult> {
  const reason = input.reason.trim();
  if (reason.length < SUSPENSION_REASON_MIN || reason.length > SUSPENSION_REASON_MAX) return { ok: false, reason: "invalid_reason" };
  if (input.organizationId === input.sessionOrganizationId) return { ok: false, reason: "own_organization" };
  return withOrg(db, input.organizationId, async (q): Promise<SuspendOrganizationResult> => {
    await q.exec(ORGANIZATION_STATE_LOCK_SQL);
    // `no key update`, e não `update`: o evento da instalação (outra conexão, logo abaixo) aponta
    // para esta organização por chave estrangeira e pede `key share` na mesma linha.
    const current = await q.one<{ suspended: boolean }>("select suspended_at is not null as suspended from organizations where id = $1 for no key update", [input.organizationId]);
    if (!current) return { ok: false, reason: "not_found" };
    if (current.suspended) return { ok: false, reason: "already_suspended" };
    const others = await withSystem(db, (system) =>
      system.one<{ n: number }>("select count(*)::int as n from organizations where suspended_at is null and id <> $1", [input.organizationId]),
    );
    if (!others || others.n === 0) return { ok: false, reason: "last_active_organization" };

    await q.exec("update organizations set suspended_at = $2, suspended_reason = $3 where id = $1", [input.organizationId, now, reason]);
    const canceledTasks = await q.exec(CANCEL_QUEUED_SQL, [KEEPS_RUNNING_WHEN_SUSPENDED, TASK_CANCELED_BY_SUSPENSION]);
    // Sem `actor_user_id`: quem suspende é a administração da instalação, que pode não ter vínculo aqui.
    await recordOrgEvent(q, "organization_suspended", { reason, canceled_tasks: canceledTasks }, now);
    await withSystem(db, (system) =>
      recordInstallationEvent(system, now, "organization_suspended", {
        actorAccountId: input.actorAccountId,
        organizationId: input.organizationId,
        payload: { reason, canceled_tasks: canceledTasks },
      }),
    );
    return { ok: true, canceledTasks };
  });
}

/**
 * Reativa uma organização suspensa, numa transação só, por `withOrg` dela: limpa `suspended_at` e o
 * motivo, cancela as tarefas canceláveis que ficaram `queued` (entraram durante a suspensão), com o
 * mesmo motivo, e grava `organization_reactivated` nas duas auditorias. Nada do que foi cancelado
 * volta: a tarefa `canceled` não é elegível para a fila.
 *
 * A organização com lápide (`deleting_at`, fatia 9b) é recusada com `deleting`: não existe desfazer
 * a exclusão. A trava da linha (`for no key update`) espera o pedido de exclusão que estiver no meio.
 */
export async function reactivateOrganization(db: Db, input: { organizationId: string; actorAccountId: string }, now: Date): Promise<ReactivateOrganizationResult> {
  return withOrg(db, input.organizationId, async (q): Promise<ReactivateOrganizationResult> => {
    const current = await q.one<{ suspended: boolean; deleting: boolean }>(
      "select suspended_at is not null as suspended, deleting_at is not null as deleting from organizations where id = $1 for no key update",
      [input.organizationId],
    );
    if (!current) return { ok: false, reason: "not_found" };
    if (current.deleting) return { ok: false, reason: "deleting" };
    if (!current.suspended) return { ok: false, reason: "not_suspended" };
    // Cancela antes de reativar: entre as duas linhas, a fila ainda vê a organização suspensa.
    const canceledTasks = await q.exec(CANCEL_QUEUED_SQL, [KEEPS_RUNNING_WHEN_SUSPENDED, TASK_CANCELED_BY_SUSPENSION]);
    await q.exec("update organizations set suspended_at = null, suspended_reason = null where id = $1", [input.organizationId]);
    await recordOrgEvent(q, "organization_reactivated", { canceled_tasks: canceledTasks }, now);
    await withSystem(db, (system) =>
      recordInstallationEvent(system, now, "organization_reactivated", {
        actorAccountId: input.actorAccountId,
        organizationId: input.organizationId,
        payload: { canceled_tasks: canceledTasks },
      }),
    );
    return { ok: true, canceledTasks };
  });
}

/**
 * O que a confirmação da suspensão diz: quantas tarefas seriam canceladas agora. `null` se a
 * organização não existe. Lê só a organização-alvo, por `withOrg`.
 */
export function suspensionPreview(db: Db, organizationId: string): Promise<{ cancelableTasks: number } | null> {
  return withOrg(db, organizationId, async (q) => {
    if (!(await q.one("select 1 from organizations where id = $1", [organizationId]))) return null;
    const row = await q.one<{ n: number }>("select count(*)::int as n from tasks where status = 'queued' and not (kind = any($1::text[]))", [KEEPS_RUNNING_WHEN_SUSPENDED]);
    return { cancelableTasks: row?.n ?? 0 };
  });
}
