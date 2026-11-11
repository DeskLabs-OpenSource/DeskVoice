import { CALL_EVENT_KINDS, type CallEventKind, type OrgQuery } from "./types";

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
