import { ERASED_TEXT } from "./erasures";
import { recordEvent } from "./events";
import { enqueueTask } from "./queue";
import type { OrgQuery } from "./types";

/**
 * Pendências com dono, prazo e fecho: o único ponto de escrita de `follow_ups`. Toda mudança vira
 * um evento na linha do tempo da ligação de origem, com o id, o dono, o prazo e o estado, e nunca
 * com texto livre: título, detalhes e nota de fechamento moram só na pendência, onde o prazo de
 * guarda os alcança (registro 0014).
 */

export type FollowUpStatus = "open" | "done" | "canceled";
/** `due`: o lembrete na hora marcada. `overdue`: o aviso único de pendência ainda aberta um dia depois. */
export type FollowUpStage = "due" | "overdue";

/** A tarefa da fila que lembra o dono (`apps/routines/src/routines/follow_up.ts`). */
export const FOLLOW_UP_TASK = "follow_up";
/**
 * "Vencida" tem uma definição só: aberta um dia depois do prazo. Antes disso, passado o prazo, ela é
 * "para agora". A rotina avisa a vencida com esta constante, e a tela marca e filtra com ela.
 */
export const FOLLOW_UP_OVERDUE_AFTER_MS = 24 * 60 * 60 * 1000;
export const FOLLOW_UP_TITLE_MAX = 200;
export const FOLLOW_UP_NOTE_MAX = 500;

interface Snapshot {
  call_id: string | null;
  owner_user_id: string | null;
  due_at: Date;
  status: FollowUpStatus;
}

const eventOf = (id: string, row: Snapshot, extra: object = {}): object => ({
  followUpId: id,
  ownerUserId: row.owner_user_id,
  dueAt: row.due_at.toISOString(),
  status: row.status,
  ...extra,
});

/**
 * A pessoa, se está ativa; senão `null`. `for share` segura a linha até o fim da transação: a
 * desativação, que grava na mesma linha, espera, e depois dela `returnFollowUpsToTeam` devolve a
 * pendência. Se a desativação veio antes, a releitura já vê a pessoa desativada.
 */
async function activePerson(q: OrgQuery, userId: string): Promise<string | null> {
  return (await q.one<{ id: string }>("select id from users where id = $1 and disabled_at is null for share", [userId]))?.id ?? null;
}

/**
 * Cria a pendência nascida numa ligação e marca o lembrete na fila para `dueAt`. O dono vem da
 * configuração do agente ("Dono das pendências"), nunca do modelo; sem dono, ou com o dono
 * desativado, a pendência é da equipe. O telefone é o de quem está do outro lado da linha.
 */
export async function createFollowUp(
  q: OrgQuery,
  input: { callId: string; agentId: string; title: string; details: string; dueAt: Date },
  now: Date,
): Promise<{ id: string; ownerUserId: string | null; taskId: string }> {
  const origin = await q.one<{ configured: string | null; caller: string | null }>(
    `select (select follow_up_owner_user_id from agents where id = $2) as configured,
            case when c.direction = 'outbound' then c.to_e164 else c.from_e164 end as caller
       from calls c where c.id = $1`,
    [input.callId, input.agentId],
  );
  if (!origin) throw new Error(`Call ${input.callId} not found in this organization: the follow-up was not created`);
  const owner = origin.configured === null ? null : await activePerson(q, origin.configured);
  const row = await q.one<{ id: string } & Snapshot>(
    `insert into follow_ups (organization_id, call_id, caller_e164, title, details, owner_user_id, due_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, call_id, owner_user_id, due_at, status`,
    [q.organizationId, input.callId, origin.caller, input.title, input.details, owner, input.dueAt, now],
  );
  if (!row) throw new Error("Follow-up was not created");
  await recordEvent(q, input.callId, "follow_up_created", eventOf(row.id, row), now);
  const taskId = await enqueueTask(q, { kind: FOLLOW_UP_TASK, payload: { followUpId: row.id, stage: "due" satisfies FollowUpStage }, callId: input.callId, runAt: input.dueAt });
  return { id: row.id, ownerUserId: row.owner_user_id, taskId };
}

export type AssignResult = "assigned" | "not_found" | "closed" | "owner_unavailable";

/** Troca o dono de uma pendência aberta. `null` devolve à equipe. Só pessoa ativa da organização recebe. */
export async function assignFollowUp(q: OrgQuery, id: string, ownerUserId: string | null, now: Date): Promise<AssignResult> {
  if (ownerUserId !== null && (await activePerson(q, ownerUserId)) === null) return "owner_unavailable";
  const row = await q.one<Snapshot>(
    "update follow_ups set owner_user_id = $2 where id = $1 and status = 'open' returning call_id, owner_user_id, due_at, status",
    [id, ownerUserId],
  );
  if (!row) return (await q.one("select 1 from follow_ups where id = $1", [id])) ? "closed" : "not_found";
  if (row.call_id) await recordEvent(q, row.call_id, "follow_up_assigned", eventOf(id, row), now);
  return "assigned";
}

export type CloseResult = "closed" | "not_found" | "already_closed";

/** Fecha uma pendência aberta: `done` (feita) ou `canceled`, com a nota de quem fechou. */
export async function closeFollowUp(
  q: OrgQuery,
  id: string,
  close: { status: Exclude<FollowUpStatus, "open">; note: string; closedBy: string },
  now: Date,
): Promise<CloseResult> {
  const row = await q.one<Snapshot>(
    // Pendência apagada a pedido do titular fecha sem nota: um novo pedido não a acharia mais (sem
    // telefone, e a chamada dela já apagada), então texto escrito agora ficaria para sempre.
    `update follow_ups set status = $2, closing_note = case when title = $6 then null else $3 end, closed_by = $4, closed_at = $5
      where id = $1 and status = 'open' returning call_id, owner_user_id, due_at, status`,
    [id, close.status, close.note, close.closedBy, now, ERASED_TEXT],
  );
  if (!row) return (await q.one("select 1 from follow_ups where id = $1", [id])) ? "already_closed" : "not_found";
  if (row.call_id) await recordEvent(q, row.call_id, "follow_up_closed", eventOf(id, row, { closedBy: close.closedBy }), now);
  return "closed";
}

/** Pessoa desativada: as pendências abertas dela voltam para a equipe, e a linha do tempo diz por quê. */
export async function returnFollowUpsToTeam(q: OrgQuery, userId: string, now: Date): Promise<number> {
  const rows = await q.many<{ id: string } & Snapshot>(
    "update follow_ups set owner_user_id = null where owner_user_id = $1 and status = 'open' returning id, call_id, owner_user_id, due_at, status",
    [userId],
  );
  for (const row of rows) {
    if (row.call_id) await recordEvent(q, row.call_id, "follow_up_assigned", eventOf(row.id, row, { reason: "owner_disabled" }), now);
  }
  return rows.length;
}

/**
 * Apaga as pendências FECHADAS antes de `before` (pelo fecho, `closed_at`), e devolve quantas. A
 * aberta nunca sai pelo prazo: é obrigação em curso. Os avisos dela saem junto (cascata). Só
 * dentro de `withOrg`: numa transação de sistema, o mesmo `delete` alcançaria todas as organizações.
 */
export async function purgeFollowUps(q: OrgQuery, before: Date): Promise<number> {
  if (q.organizationId === "") throw new Error("purgeFollowUps runs inside withOrg, never withSystem: it would reach every organization");
  return q.exec("delete from follow_ups where status <> 'open' and closed_at < $1", [before]);
}
