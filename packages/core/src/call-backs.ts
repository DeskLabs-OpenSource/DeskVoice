import { CALL_BACK_ATTEMPTS, CALL_BACK_INTERVAL_MINUTES } from "./drop-follow-up";
import { lockCall } from "./erasures";
import { recordEvent } from "./events";
import { createFollowUp } from "./follow-ups";
import { enqueueTask } from "./queue";
import type { Db, OrgQuery } from "./types";
import { withSystem } from "./with-org";

/**
 * A religação da ligação que caiu (desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.6, fatia
 * 3). O caminho tem três donos, e só o último fala com o Asterisk:
 *
 * 1. a revisão (`review_call`, modo `call_back`) agenda a tentativa 1 (`scheduleCallBack`);
 * 2. a rotina `call_back`, na hora marcada, passa a linha a `due` e avisa no canal `call_backs`;
 * 3. o processo de voz reivindica a linha `due` e chama `startOutboundCall`, que confere a política de
 *    saída (`checkOutboundAllowed`) na mesma transação que cria a chamada.
 *
 * O resultado de cada tentativa vai para a linha do tempo da ligação original
 * (`drop_follow_up_result`, seção 3.7) por `settleCallBack`, que também abre a pendência de reserva
 * quando a religação não acontece. Religação nunca gera religação: a revisão de uma ligação com
 * `calls.call_back_of` só chega aqui.
 */

/** A tarefa da fila que passa a linha a `due` (`apps/routines/src/routines/call_back.ts`). */
export const CALL_BACK_TASK = "call_back";
/** O canal do `pg_notify` que acorda o processo de voz. */
export const CALL_BACKS_CHANNEL = "call_backs";

export type CallBackStatus = "scheduled" | "due" | "placed" | "refused" | "expired" | "cancelled";

/** As recusas de `startOutboundCall` que acontecem antes de existir a linha em `calls`. */
export const CALL_BACK_REFUSALS_BEFORE_CALL = ["invalid_number", "agent_not_found", "agent_disabled", "no_line"] as const;
/** Todo código que `call_backs.refusal_code` aceita: os da política, os de antes da chamada e a falha de originar. */
export const CALL_BACK_REFUSAL_CODES = [
  "organization_suspended",
  "outbound_disabled",
  "outbound_not_allowed",
  "outside_window",
  "do_not_call",
  "daily_cap_reached",
  "attempts_exhausted",
  ...CALL_BACK_REFUSALS_BEFORE_CALL,
  "originate_failed",
] as const;
export type CallBackRefusalCode = (typeof CALL_BACK_REFUSAL_CODES)[number];
export const isCallBackRefusalCode = (code: unknown): code is CallBackRefusalCode => (CALL_BACK_REFUSAL_CODES as readonly unknown[]).includes(code);

/** As ações de `drop_follow_up_result` da religação. */
export type CallBackResultAction = "call_back_placed" | "call_back_refused" | "call_back_expired" | "call_back_answered" | "call_back_not_answered";

/** O payload de `drop_follow_up_result` da religação: só campos fixos, nenhum texto e nenhum número. */
export interface CallBackResultPayload {
  action: CallBackResultAction;
  attempt: number;
  callId?: string;
  refusalCode?: CallBackRefusalCode;
  costCents?: number;
}

/** O motivo, em frase fixa, da pendência de reserva "Retornar para <número>: a religação não aconteceu: <motivo>". */
export const CALL_BACK_FAILED_REASON: Record<CallBackRefusalCode | "not_answered" | "expired", string> = {
  not_answered: "ninguém atendeu",
  expired: "o processo de voz não discou a tempo",
  organization_suspended: "a organização está suspensa",
  outbound_disabled: "as ligações de saída estão desligadas",
  outbound_not_allowed: "a administração da instalação bloqueou as ligações de saída",
  outside_window: "estava fora do horário das ligações de saída",
  do_not_call: "o número está na lista de não ligar",
  daily_cap_reached: "a linha chegou ao teto de ligações do dia",
  attempts_exhausted: "o número chegou ao limite de tentativas",
  invalid_number: "o número não é válido",
  agent_not_found: "o agente não existe mais",
  agent_disabled: "o agente está desligado",
  no_line: "o agente não tem uma linha para ligar",
  originate_failed: "a central telefônica não conseguiu discar",
};
export const CALL_BACK_FAILED_PHRASE = "a religação não aconteceu";
export const callBackFailedTitle = (caller: string, reason: keyof typeof CALL_BACK_FAILED_REASON): string =>
  `Retornar para ${caller}: ${CALL_BACK_FAILED_PHRASE}: ${CALL_BACK_FAILED_REASON[reason]}`;
export const CALL_BACK_FAILED_DETAILS =
  "Aberta pelo supervisor de regras fixas: a ligação caiu, e a religação não aconteceu. Veja a linha do tempo da ligação.";

const MINUTE_MS = 60 * 1000;

/** Uma linha de `call_backs`, como os três donos do caminho a leem. */
export interface CallBackRow {
  id: string;
  origin_call_id: string;
  agent_id: string | null;
  to_e164: string | null;
  attempt: number;
  due_at: Date;
  status: CallBackStatus;
  result_call_id: string | null;
}
export const CALL_BACK_COLUMNS = "id, origin_call_id, agent_id, to_e164, attempt, due_at, status, result_call_id";

/**
 * Insere a tentativa `attempt` e enfileira a tarefa `call_back` para `dueAt`, na transação de `q`. O
 * relógio é a fila (`run_at`). Tentativa acima do teto fixo não nasce, e o índice único por
 * (ligação original, tentativa) segura a repetição.
 */
export async function scheduleCallBack(q: OrgQuery, input: { originCallId: string; agentId: string | null; toE164: string; attempt: number; dueAt: Date }, now: Date): Promise<string> {
  if (input.attempt < 1 || input.attempt > CALL_BACK_ATTEMPTS) throw new Error(`Call-back attempt ${input.attempt} is outside 1..${CALL_BACK_ATTEMPTS}`);
  const row = await q.one<{ id: string }>(
    `insert into call_backs (organization_id, origin_call_id, agent_id, to_e164, attempt, due_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [q.organizationId, input.originCallId, input.agentId, input.toE164, input.attempt, input.dueAt, now],
  );
  if (!row) throw new Error(`Call-back for call ${input.originCallId} was not created`);
  await enqueueTask(q, { kind: CALL_BACK_TASK, payload: { callBackId: row.id }, callId: input.originCallId, runAt: input.dueAt });
  return row.id;
}

/** O que aconteceu com uma tentativa, para `settleCallBack`. */
export type CallBackOutcome =
  | { action: "call_back_placed"; callId: string }
  | { action: "call_back_refused"; refusalCode: CallBackRefusalCode; callId?: string }
  | { action: "call_back_expired" }
  | { action: "call_back_answered"; callId: string; costCents: number }
  | { action: "call_back_not_answered"; callId: string; costCents: number };

/**
 * Grava o resultado da tentativa na ligação original e decide o que vem depois (seção 3.6, passo 5),
 * na transação de `q`, que já segura a linha de `call_backs`:
 *
 * - `placed`: só registra; o fim da religação volta aqui pela revisão dela;
 * - atendida: fim. Mesmo que caia de novo, não há nova tentativa;
 * - não atendida com tentativa sobrando: agenda a próxima, `agora + intervalo`;
 * - não atendida na última tentativa, recusada (menos `do_not_call`) ou expirada: a pendência de
 *   reserva, a mesma do supervisor (`source = 'review_call'`, uma por ligação);
 * - recusada por `do_not_call`: só registra. Quem pediu para não ser ligado também não recebe ligação
 *   de uma pessoa da equipe.
 *
 * Ligação original apagada a pedido do titular não recebe pendência: ela traria o número de volta.
 */
export async function settleCallBack(q: OrgQuery, row: CallBackRow, outcome: CallBackOutcome, now: Date): Promise<void> {
  const { erased } = await lockCall(q, row.origin_call_id);
  const payload: CallBackResultPayload = {
    action: outcome.action,
    attempt: row.attempt,
    ...("callId" in outcome && outcome.callId !== undefined && { callId: outcome.callId }),
    ...("refusalCode" in outcome && { refusalCode: outcome.refusalCode }),
    ...("costCents" in outcome && { costCents: outcome.costCents }),
  };
  await recordEvent(q, row.origin_call_id, "drop_follow_up_result", payload, now);

  let reason: keyof typeof CALL_BACK_FAILED_REASON | null = null;
  if (outcome.action === "call_back_expired") reason = "expired";
  else if (outcome.action === "call_back_refused" && outcome.refusalCode !== "do_not_call") reason = outcome.refusalCode;
  else if (outcome.action === "call_back_not_answered") {
    if (row.attempt < CALL_BACK_ATTEMPTS && row.to_e164 !== null && !erased) {
      await scheduleCallBack(
        q,
        { originCallId: row.origin_call_id, agentId: row.agent_id, toE164: row.to_e164, attempt: row.attempt + 1, dueAt: new Date(now.getTime() + CALL_BACK_INTERVAL_MINUTES * MINUTE_MS) },
        now,
      );
      return;
    }
    reason = "not_answered";
  }
  if (reason === null || erased) return;

  const origin = await q.one<{ caller: string | null }>("select from_e164 as caller from calls where id = $1", [row.origin_call_id]);
  if (!origin?.caller) return;
  if (await q.one("select 1 from follow_ups where call_id = $1 and source = 'review_call'", [row.origin_call_id])) return;
  await createFollowUp(
    q,
    {
      callId: row.origin_call_id,
      agentId: row.agent_id,
      title: callBackFailedTitle(origin.caller, reason),
      details: CALL_BACK_FAILED_DETAILS,
      dueAt: now,
      origin: { source: "review_call", case: "call_back_failed" },
    },
    now,
  );
}

/**
 * As religações `due` de todas as organizações, as mais antigas primeiro: a varredura do processo de
 * voz. Só o id e a organização; cada linha é reivindicada depois, dentro de `withOrg` da organização
 * dela (`for update skip locked`). É a única leitura da religação que atravessa organizações.
 */
export async function dueCallBacks(db: Db, limit: number): Promise<Array<{ id: string; organizationId: string }>> {
  const rows = await withSystem(db, (q) => q.many<{ id: string; organization_id: string }>("select id, organization_id from call_backs where status = 'due' order by due_at, id limit $1", [limit]));
  return rows.map((row) => ({ id: row.id, organizationId: row.organization_id }));
}
