import { createFollowUp, withOrg, type OrgQuery } from "@deskvoice/core";
import type { Routine } from "../types";

/**
 * O supervisor de regras fixas (desenho 2026-11-13-equipe-de-agentes-e-memoria, seção 4.4; registro
 * 0020, escolha 5A). Roda no fim de toda ligação, junto com `summarize_call`, e abre **uma**
 * pendência "Retornar para <número>: <o caso>" quando a ligação terminou sem próximo passo num dos
 * quatro casos abaixo. Não chama modelo e não gasta: só lê os eventos da chamada.
 *
 * Nada do que foi dito na ligação entra na pendência. A rotina nem lê a transcrição, o resumo da
 * passagem, o `reason` ou o texto das ferramentas: lê só o tipo do evento e campos estáveis (nome da
 * ferramenta, `ok`, o motivo da recusa, o id da aprovação). O título e os detalhes são texto fixo,
 * um por caso. A fala de quem ligou é dado, nunca instrução.
 */

export const REVIEW_CASES = ["engine_failed", "transfer_failed", "caller_hung_up_waiting", "whatsapp_not_sent"] as const;
export type ReviewCase = (typeof REVIEW_CASES)[number];

/** A frase de cada caso, no título e nos detalhes. Texto fixo do sistema. */
export const CASE_PHRASE: Record<ReviewCase, string> = {
  engine_failed: "o motor de voz caiu ou não estava pronto",
  transfer_failed: "a transferência para uma pessoa falhou",
  caller_hung_up_waiting: "a pessoa desligou esperando uma aprovação",
  whatsapp_not_sent: "a mensagem de WhatsApp não saiu",
};

export const reviewTitle = (caller: string, found: ReviewCase): string => `Retornar para ${caller}: ${CASE_PHRASE[found]}`;
/**
 * Os detalhes, também texto fixo. O caso 1 numa ligação que já tinha sido transferida tem frase
 * própria: ali alguém pode ter atendido, mas o sistema não tem como confirmar.
 */
export const TRANSFERRED_DETAILS =
  "Aberta pelo supervisor de regras fixas, depois da ligação: o motor de voz caiu ou não estava pronto. A ligação foi transferida, mas não há confirmação de que alguém atendeu. Veja a linha do tempo da ligação.";
export const reviewDetails = (found: ReviewCase, transferred = false): string =>
  found === "engine_failed" && transferred
    ? TRANSFERRED_DETAILS
    : `Aberta pelo supervisor de regras fixas, depois da ligação: ${CASE_PHRASE[found]}, e ninguém ficou com o próximo passo. Veja a linha do tempo da ligação.`;

/** Os motivos de `call_refused` que são falta de motor (o caminho de `connectEngine` em `call-session.ts`). Política não conta. */
const ENGINE_REFUSALS: ReadonlySet<string> = new Set(["engine_not_configured", "engine_not_responding"]);

/** Só os campos estáveis de um evento: nenhum texto livre. */
export interface ReviewEvent {
  kind: string;
  /** `payload.name` de `tool_result`. */
  name: string | null;
  /** `payload.ok` de `tool_result`. */
  ok: boolean | null;
  /** `payload.reason` de `call_refused` (um código, como `engine_not_configured`). */
  reason: string | null;
  /** `payload.approvalId` de `approval_requested` e `approval_decided`. */
  approvalId: string | null;
}

/** Depois do índice `from`, há algum evento de um destes tipos? */
/**
 * Houve uma falha de `tool` sem nenhum evento de `kinds` depois dela? Com `retried`, uma nova
 * chamada da mesma ferramenta que deu certo depois da falha também fecha o caso.
 */
function failedWithoutFollowUp(events: readonly ReviewEvent[], tool: string, kinds: readonly string[], retried = false): boolean {
  const closes = (event: ReviewEvent): boolean => kinds.includes(event.kind) || (retried && event.kind === "tool_result" && event.name === tool && event.ok === true);
  return events.some((event, index) => event.kind === "tool_result" && event.name === tool && event.ok === false && !events.slice(index + 1).some(closes));
}

/**
 * O primeiro dos quatro casos que bate, nesta ordem, ou `null`. Os eventos vêm na ordem em que
 * foram gravados; `endReason` é o `calls.end_reason`.
 */
export function reviewCaseOf(events: readonly ReviewEvent[], endReason: string | null): ReviewCase | null {
  const has = (kind: string): boolean => events.some((event) => event.kind === kind);

  // 1. O motor caiu ou faltou. Com recado deixado, o recado já tem o seu caminho.
  const engineDown = has("engine_failed") || events.some((event) => event.kind === "call_refused" && event.reason !== null && ENGINE_REFUSALS.has(event.reason));
  if (engineDown && !has("voicemail_left")) return "engine_failed";

  // 2. `transfer_to_human` falhou, e ninguém criou pendência nem avisou alguém depois.
  if (failedWithoutFollowUp(events, "transfer_to_human", ["follow_up_created", "human_notified"])) return "transfer_failed";

  // 3. Quem ligou desligou com uma aprovação pedida e não decidida (a espera é solta por
  // `callEnded.abort`, em `finish`, e `approval_decided` nunca é gravado).
  if (endReason === "caller_hangup") {
    const decided = new Set(events.flatMap((event) => (event.kind === "approval_decided" && event.approvalId ? [event.approvalId] : [])));
    if (events.some((event) => event.kind === "approval_requested" && (event.approvalId === null || !decided.has(event.approvalId)))) return "caller_hung_up_waiting";
  }

  // 4. O WhatsApp foi recusado ou não confirmado (`ok: false`), e depois nem uma pendência foi
  // criada nem uma nova tentativa saiu (a recusa do `to` inválido pede para chamar de novo).
  if (failedWithoutFollowUp(events, "send_whatsapp", ["follow_up_created"], true)) return "whatsapp_not_sent";

  return null;
}

/** O que a revisão fez com a chamada; a fila não usa, os testes sim. */
export type ReviewResult = "opened" | "no_case" | "skipped" | "already_reviewed";

/**
 * Revê uma chamada e abre a pendência, se for o caso, na transação de `q`.
 *
 * A linha da chamada é travada (`for update`) antes de tudo: duas revisões da mesma chamada se
 * enfileiram aqui, e a segunda vê a pendência da primeira. O índice único parcial
 * (`follow_ups_one_review_per_call_idx`) é a garantia final. A mesma trava segura o apagamento a
 * pedido do titular, que trava as chamadas antes de escrever: a pendência ou nasce antes e é
 * alcançada por ele, ou não nasce.
 */
export async function reviewCall(q: OrgQuery, callId: string, now: Date): Promise<ReviewResult> {
  const call = await q.one<{ agent_id: string | null; channel: string; erased: boolean; caller: string | null; end_reason: string | null }>(
    `select agent_id, channel, erased_at is not null as erased, end_reason,
            case when direction = 'outbound' then to_e164 else from_e164 end as caller
       from calls where id = $1 for update`,
    [callId],
  );
  // A chamada pode ter sumido entre o fim e a revisão (outra organização, ou apagada): nada a fazer,
  // e a fila segue. Apagada a pedido do titular, também não: a pendência traria o número de volta.
  if (!call || call.erased) return "skipped";
  // A simulada é teste de quem configura, não ligação de alguém (a mesma regra da #291). Sem número,
  // não há a quem retornar.
  if (call.channel === "simulated" || call.caller === null) return "skipped";
  if (await q.one("select 1 from follow_ups where call_id = $1 and source = 'review_call'", [callId])) return "already_reviewed";

  const events = await q.many<ReviewEvent>(
    `select kind,
            case when kind = 'tool_result' then payload->>'name' end as name,
            case when kind = 'tool_result' and jsonb_typeof(payload->'ok') = 'boolean' then (payload->>'ok')::boolean end as ok,
            case when kind = 'call_refused' then payload->>'reason' end as reason,
            case when kind in ('approval_requested', 'approval_decided') then payload->>'approvalId' end as "approvalId"
       from call_events
      where call_id = $1 and kind in ('engine_failed', 'call_refused', 'voicemail_left', 'tool_result', 'follow_up_created', 'human_notified', 'approval_requested', 'approval_decided', 'transfer_started')
      order by id`,
    [callId],
  );
  const found = reviewCaseOf(events, call.end_reason);
  if (found === null) return "no_case";
  await createFollowUp(
    q,
    { callId, agentId: call.agent_id, title: reviewTitle(call.caller, found), details: reviewDetails(found, events.some((event) => event.kind === "transfer_started")), dueAt: now, origin: { source: "review_call", case: found } },
    now,
  );
  return "opened";
}

const routine: Routine = {
  kind: "review_call",
  async run(task, deps) {
    const { callId } = task;
    if (callId === null) throw new Error("review_call needs a task with callId");
    await withOrg(deps.db, task.organizationId, (q) => reviewCall(q, callId, deps.clock.now()));
  },
};

export default routine;
