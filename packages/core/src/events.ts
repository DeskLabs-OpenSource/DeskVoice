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

/**
 * A forma expurgada da análise, como expressão SQL sobre a linha de `calls`, só com campos de
 * vocabulário fechado copiados um a um: o que não está nomeado aqui (evidência, objeções, pontos
 * fortes e fracos, próximo passo) não passa. O prazo de guarda e o apagamento a pedido do titular
 * usam a mesma forma.
 */
export const PURGED_ANALYSIS_SQL = `jsonb_build_object(
      'rubricVersion', analysis->'rubricVersion',
      'model', analysis->'model',
      'criteria', coalesce(
        (select jsonb_agg(jsonb_build_object('id', criterion->'id', 'status', criterion->'status') order by position)
           from jsonb_array_elements(analysis->'criteria') with ordinality as rubric(criterion, position)),
        '[]'::jsonb),
      'temperature', jsonb_build_object(
        'start', analysis->'temperature'->'start',
        'middle', analysis->'temperature'->'middle',
        'end', analysis->'temperature'->'end'),
      'objectionCount', jsonb_array_length(coalesce(analysis->'objections', '[]'::jsonb)),
      'purged', true)`;

const PURGE_ANALYSIS_SQL = `
  update calls set analysis = ${PURGED_ANALYSIS_SQL}
   where analysis is not null and not (analysis ? 'purged') and started_at < $1`;

/** O que fica no lugar do texto de uma fala expurgada: a linha do tempo diz que houve fala, sem a fala. */
export const PURGED_TRANSCRIPT = { purged: true } as const;

/**
 * O que fica no lugar do resumo de uma chamada cuja conversa saiu pelo prazo: a tela diz que houve
 * resumo, sem o resumo. Mesma ideia do marcador da fala, num campo de texto (`calls.summary`).
 */
export const PURGED_SUMMARY_TEXT = "[resumo apagado pelo prazo de guarda]";

/**
 * Troca o texto das falas (`transcript_user`, `transcript_agent`) gravadas antes de `before` pelo
 * marcador, e devolve quantas trocou. É um dos dois caminhos que reescrevem `call_events`; o outro é o
 * apagamento a pedido do titular (`eraseCaller`). Fala já
 * expurgada não tem mais `text`, então rodar de novo não reconta. Só dentro de `withOrg`: numa
 * transação de sistema, o mesmo `update` alcançaria todas as organizações.
 *
 * A fala que sustenta o desfecho (`calls.outcome_evidence`) é cópia da transcrição e sai junto, nas
 * chamadas começadas antes de `before`. O desfecho e a confiança ficam: não são fala de ninguém.
 *
 * A análise (`calls.analysis`) é derivada da transcrição e, nas mesmas chamadas, vira a forma
 * expurgada de `PurgedCallAnalysis`: ficam a régua, o status de cada critério, a temperatura e a
 * contagem de objeções; sai todo texto. `analysis_score` fica. A já expurgada não é reescrita.
 *
 * O motivo do pedido para parar a gravação (`calls.recording_pause_reason` e o `reason` do evento
 * `recording_paused`) é fala de quem ligou e sai junto. Fica o fato: quando parou e por quem.
 *
 * O resumo (`calls.summary`) é escrito a partir das falas e guarda frases de quem ligou ("Cliente:
 * ..."): nas chamadas começadas antes de `before`, vira `PURGED_SUMMARY_TEXT` e entra na contagem
 * devolvida, junto com as falas. O resumo de chamada apagada a pedido do titular não é tocado: ele
 * já tem o marcador do apagamento, e essa linha não volta.
 */
export async function purgeTranscripts(q: OrgQuery, before: Date): Promise<number> {
  if (q.organizationId === "") throw new Error("purgeTranscripts runs inside withOrg, never withSystem: it would reach every organization");
  await q.exec("update calls set outcome_evidence = null where outcome_evidence is not null and started_at < $1", [before]);
  await q.exec(PURGE_ANALYSIS_SQL, [before]);
  await q.exec("update calls set recording_pause_reason = null where recording_pause_reason is not null and started_at < $1", [before]);
  await q.exec("update call_events set payload = (payload - 'reason') || '{\"reasonPurged\": true}' where kind = 'recording_paused' and payload ? 'reason' and at < $1", [before]);
  const speech = await q.exec("update call_events set payload = $2 where kind in ('transcript_user', 'transcript_agent') and payload ? 'text' and at < $1", [
    before,
    JSON.stringify(PURGED_TRANSCRIPT),
  ]);
  // A linha da chamada fica: sai só o texto do resumo, e o marcador já gravado não é reescrito nem
  // recontado numa segunda passagem.
  const summaries = await q.exec("update calls set summary = $2 where summary is not null and summary <> $2 and erased_at is null and started_at < $1", [
    before,
    PURGED_SUMMARY_TEXT,
  ]);
  return speech + summaries;
}
