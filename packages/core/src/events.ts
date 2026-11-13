import { CALL_EVENT_KINDS, ORG_EVENT_KINDS, type CallEventKind, type OrgEventKind, type OrgQuery } from "./types";

/**
 * Grava um evento na linha do tempo da chamada. O gatilho do banco avisa o canal `call_events`
 * com `organization_id:call_id:id` quando a transação confirma.
 */
export async function recordEvent(q: OrgQuery, callId: string, kind: CallEventKind, payload: object, at: Date): Promise<void> {
  if (!CALL_EVENT_KINDS.includes(kind)) throw new Error(`Unknown call event kind: ${JSON.stringify(kind)}`);
  // A organização vem da própria chamada: vale igual dentro de `withOrg` e de `withSystem`, e o
  // evento nunca fica numa organização diferente da chamada.
  const inserted = await q.exec(
    "insert into call_events (organization_id, call_id, at, kind, payload) select organization_id, id, $2, $3, $4 from calls where id = $1",
    [callId, at, kind, JSON.stringify(payload)],
  );
  if (inserted !== 1) throw new Error(`Call ${callId} not found in this organization: event ${kind} was not recorded`);
}

/** Grava um evento da organização (fora de uma chamada). `actorUserId` nulo: quem fez foi uma rotina. */
export async function recordOrgEvent(q: OrgQuery, kind: OrgEventKind, payload: object, at: Date, actorUserId: string | null = null): Promise<void> {
  if (!ORG_EVENT_KINDS.includes(kind)) throw new Error(`Unknown organization event kind: ${JSON.stringify(kind)}`);
  await q.exec("insert into organization_events (organization_id, at, kind, actor_user_id, payload) values ($1, $2, $3, $4, $5)", [
    q.organizationId,
    at,
    kind,
    actorUserId,
    JSON.stringify(payload),
  ]);
}

/** O que fica no lugar do texto de uma fala expurgada: a linha do tempo diz que houve fala, sem a fala. */
export const PURGED_TRANSCRIPT = { purged: true } as const;

/**
 * Troca o texto das falas (`transcript_user`, `transcript_agent`) gravadas antes de `before` pelo
 * marcador, e devolve quantas trocou. É o único caminho que reescreve `call_events`. Fala já
 * expurgada não tem mais `text`, então rodar de novo não reconta. Só dentro de `withOrg`: numa
 * transação de sistema, o mesmo `update` alcançaria todas as organizações.
 *
 * A fala que sustenta o desfecho (`calls.outcome_evidence`) é cópia da transcrição e sai junto, nas
 * chamadas começadas antes de `before`. O desfecho e a confiança ficam: não são fala de ninguém.
 */
export async function purgeTranscripts(q: OrgQuery, before: Date): Promise<number> {
  if (q.organizationId === "") throw new Error("purgeTranscripts runs inside withOrg, never withSystem: it would reach every organization");
  await q.exec("update calls set outcome_evidence = null where outcome_evidence is not null and started_at < $1", [before]);
  return q.exec("update call_events set payload = $2 where kind in ('transcript_user', 'transcript_agent') and payload ? 'text' and at < $1", [
    before,
    JSON.stringify(PURGED_TRANSCRIPT),
  ]);
}
