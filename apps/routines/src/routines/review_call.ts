import { callerMessageBlock, createFollowUp, dropFollowUpDefaultMessage, enqueueTask, lockCall, OPEN_TURNS, recordEvent, withOrg, type DropFollowUpMode, type OpenTurn, type OrgQuery } from "@deskvoice/core";
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
 *
 * O caso 5, `call_dropped` (desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seções 2 e 3.3), é a
 * ligação recebida e atendida que caiu: quem ligou desligou com a vez aberta (`caller_waiting` ou
 * `tool_running`), quem ligou desligou depois do "pode repetir?" sem falar de novo (condição 2(c),
 * decisão de 17/11), ou o sistema falhou (`internal_error`, que fica fora do caso 1). Ele e o caso 1
 * seguem o modo do agente que atendeu
 * (`agents.drop_follow_up`): em `off`, o padrão, o caso 1 abre a pendência como sempre e o caso 5 não
 * faz nada, e a revisão é a de antes; em `task`, os dois abrem; em `whatsapp` (fatia 2, seção 3.5),
 * os dois mandam ao número de quem ligou o texto fixo do agente, pela fila de avisos, e a pendência
 * fica de reserva para quando a mensagem não pode sair.
 */

export const REVIEW_CASES = ["engine_failed", "transfer_failed", "caller_hung_up_waiting", "whatsapp_not_sent", "call_dropped"] as const;
export type ReviewCase = (typeof REVIEW_CASES)[number];

/** A frase de cada caso, no título e nos detalhes. Texto fixo do sistema. */
export const CASE_PHRASE: Record<ReviewCase, string> = {
  engine_failed: "o motor de voz caiu ou não estava pronto",
  transfer_failed: "a transferência para uma pessoa falhou",
  caller_hung_up_waiting: "a pessoa desligou esperando uma aprovação",
  whatsapp_not_sent: "a mensagem de WhatsApp não saiu",
  call_dropped: "a ligação caiu no meio da conversa",
};

/** Os casos que são queda (seção 2 do desenho): só eles seguem o modo do agente. */
const DROP_CASES: ReadonlySet<ReviewCase> = new Set<ReviewCase>(["engine_failed", "call_dropped"]);

export const reviewTitle = (caller: string, found: ReviewCase): string => `Retornar para ${caller}: ${CASE_PHRASE[found]}`;

/** A reserva do modo `whatsapp` quando a mensagem para quem ligou falhou na entrega (seção 3.4 do desenho). Texto fixo. */
export const CALLER_MESSAGE_FAILED_PHRASE = "a mensagem para quem ligou não saiu";
export const callerMessageFailedTitle = (caller: string): string => `Retornar para ${caller}: ${CALLER_MESSAGE_FAILED_PHRASE}`;
export const CALLER_MESSAGE_FAILED_DETAILS =
  "Aberta pelo supervisor de regras fixas: a ligação caiu, e a mensagem no WhatsApp para quem ligou não saiu. Veja a linha do tempo da ligação.";

/** Uma mensagem para quem ligou por número a cada 24 horas, na organização (seção 3.3 do desenho). */
export const CALLER_MESSAGE_EVERY_MS = 24 * 60 * 60 * 1000;
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
const ENGINE_REFUSALS: ReadonlySet<string> = new Set(["engine_not_configured", "engine_not_responding", "engine_refused"]);

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

/** O que a revisão sabe da ligação além dos eventos, para o caso 5. */
export interface DropFacts {
  direction: "inbound" | "outbound";
  /** `call_ended.openTurn`: só existe no fim por `caller_hangup`. */
  openTurn: OpenTurn | null;
  /** A condição 2(c): veja `hungUpAfterAsk`. Ausente vale `false`. */
  afterAsk?: boolean;
}

/** Os eventos da condição 2(c), na ordem da linha do tempo (`at`, e o `id` no empate). Só o tipo e `action`. */
export interface TurnEvent {
  kind: "caller_unanswered" | "transcript_user" | "transcript_agent";
  /** `payload.action` de `caller_unanswered`. */
  action: string | null;
}

/**
 * A parte da condição 2(c) lida dos eventos (decisão de 17/11; a revisão exige também
 * `call_ended.callerSpokeAfterAsk === false`): a guarda pediu para repetir (`caller_unanswered` com
 * `action: "asked_to_repeat"`) e, depois do **último** pedido, quem ligou não falou (nenhum
 * `transcript_user`) e o agente não respondeu de fato (no máximo um `transcript_agent`, o espaço da
 * transcrição do próprio pedido). Conta eventos, sem ler texto.
 */
export function hungUpAfterAsk(events: readonly TurnEvent[]): boolean {
  let last = -1;
  events.forEach((event, index) => {
    if (event.kind === "caller_unanswered" && event.action === "asked_to_repeat") last = index;
  });
  if (last < 0) return false;
  const after = events.slice(last + 1);
  return !after.some((event) => event.kind === "transcript_user") && after.filter((event) => event.kind === "transcript_agent").length <= 1;
}

/**
 * Houve uma falha de `tool` sem nenhum evento de `kinds` depois dela? Com `retried`, uma nova
 * chamada da mesma ferramenta que deu certo depois da falha também fecha o caso.
 */
function failedWithoutFollowUp(events: readonly ReviewEvent[], tool: string, kinds: readonly string[], retried = false): boolean {
  const closes = (event: ReviewEvent): boolean => kinds.includes(event.kind) || (retried && event.kind === "tool_result" && event.name === tool && event.ok === true);
  return events.some((event, index) => event.kind === "tool_result" && event.name === tool && event.ok === false && !events.slice(index + 1).some(closes));
}

/**
 * O primeiro dos cinco casos que bate, nesta ordem, ou `null`. Os eventos vêm na ordem em que
 * foram gravados; `endReason` é o `calls.end_reason`. Sem `drop`, o caso 5 não é avaliado.
 */
export function reviewCaseOf(events: readonly ReviewEvent[], endReason: string | null, drop?: DropFacts): ReviewCase | null {
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

  // 5. A ligação recebida e atendida caiu, e ninguém ficou com o próximo passo na própria ligação.
  // Caiu: o sistema falhou (`internal_error`), ou quem ligou desligou com a vez aberta, esperando
  // além do prazo da guarda (`caller_waiting`) ou durante uma ação do agente (`tool_running`). A vez
  // fechada (`null`) é o "obrigado, tchau"; o `agent_speaking` é gravado e não conta, porque quem
  // desliga enquanto o agente fala, na maior parte, já ouviu o que precisava (decisão de 16/11).
  // Ou, com a vez fechada (`null`), desligou depois do "pode repetir?" sem falar de novo: a guarda
  // desarma ao pedir, e a espera longa só aparece nos eventos (condição 2(c), decisão de 17/11).
  const droppedLine =
    endReason === "internal_error" ||
    (endReason === "caller_hangup" && (drop?.openTurn === "caller_waiting" || drop?.openTurn === "tool_running" || (drop?.openTurn === null && drop.afterAsk === true)));
  if (
    drop?.direction === "inbound" &&
    droppedLine &&
    has("call_answered") &&
    !["transfer_started", "voicemail_left", "follow_up_created", "human_notified"].some(has) &&
    !events.some((event) => event.kind === "tool_result" && event.name === "send_whatsapp" && event.ok === true)
  )
    return "call_dropped";

  return null;
}

/**
 * O payload de `drop_follow_up`: só campos fixos, nenhum texto da conversa. `action` é o que
 * aconteceu, ou, na simulada, o que teria acontecido numa ligação de verdade.
 */
export interface DropFollowUpPayload {
  case: "engine_failed" | "call_dropped";
  mode: Exclude<DropFollowUpMode, "off">;
  action: DropFollowUpAction;
  /** Só com `action: "skipped"`. */
  reason?: DropFollowUpSkip;
  simulated: boolean;
  openTurn: OpenTurn | null;
}
export type DropFollowUpAction = "task_opened" | "whatsapp_queued" | "skipped";
/**
 * Por que o modo não agiu. `do_not_call`: a pessoa pediu para não ser procurada, e não há pendência.
 * `mode_unavailable` e `recent_follow_up`: cai na pendência de reserva.
 */
export type DropFollowUpSkip = "do_not_call" | "mode_unavailable" | "recent_follow_up";

/** O payload de `drop_follow_up_result` desta fatia: só as ações do WhatsApp. As da religação vêm nas fatias 3 e 4. */
export interface DropFollowUpResultPayload {
  action: "whatsapp_sent" | "whatsapp_failed";
}

/**
 * O que o modo `whatsapp` faz com uma queda, conferido na hora de agir. A ordem é a do desenho: sem
 * o pré-requisito, nada sai; número na lista de não ligar não recebe e não vira pendência; número que
 * já recebeu nas últimas 24 horas não recebe de novo. O limite olha qualquer ligação da organização,
 * e não a simulada: o número de quem liga pode ser forjado, e sem ele quem quisesse incomodar alguém
 * ligaria com o número da vítima e desligaria no meio, várias vezes.
 */
async function whatsAppAction(q: OrgQuery, caller: string | null, now: Date): Promise<{ action: DropFollowUpAction; reason?: DropFollowUpSkip }> {
  if ((await callerMessageBlock(q)) !== null) return { action: "skipped", reason: "mode_unavailable" };
  // Simulada sem número: não há lista nem limite a conferir, e a mensagem teria saído.
  if (caller === null) return { action: "whatsapp_queued" };
  // Duas revisões de ligações diferentes do mesmo número, ao mesmo tempo, passariam as duas pelo
  // limite: a trava por número, até o fim da transação, faz a segunda ver o aviso da primeira.
  await q.exec("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`drop_follow_up_whatsapp:${q.organizationId}:${caller}`]);
  if (await q.one("select 1 from do_not_call where organization_id = $1 and e164 = $2", [q.organizationId, caller])) return { action: "skipped", reason: "do_not_call" };
  // O aviso `caller` nasce na mesma transação do `drop_follow_up` com `whatsapp_queued`, e só nela (a
  // simulada não cria aviso): contar um é contar o outro, e o índice por data dos avisos limita a busca
  // às últimas 24 horas.
  const recent = await q.one(
    "select 1 from notifications where organization_id = $1 and audience = 'caller' and target = $2 and created_at > $3 limit 1",
    [q.organizationId, caller, new Date(now.getTime() - CALLER_MESSAGE_EVERY_MS)],
  );
  if (recent) return { action: "skipped", reason: "recent_follow_up" };
  return { action: "whatsapp_queued" };
}

const openTurnOf = (value: unknown): OpenTurn | null => (OPEN_TURNS as readonly unknown[]).includes(value) ? (value as OpenTurn) : null;

/**
 * O que a revisão fez com a chamada; a fila não usa, os testes sim. `simulated`: a simulada gravou o
 * que teria acontecido. `messaged`: a mensagem para quem ligou entrou na fila de avisos.
 * `do_not_call`: o número está na lista de não ligar, e nada saiu nem foi aberto.
 */
export type ReviewResult = "opened" | "no_case" | "skipped" | "already_reviewed" | "simulated" | "messaged" | "do_not_call";

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
  const call = await q.one<{
    agent_id: string | null;
    channel: string;
    direction: "inbound" | "outbound";
    erased: boolean;
    caller: string | null;
    end_reason: string | null;
    mode: DropFollowUpMode | null;
    message: string | null;
    language: string | null;
  }>(
    `select c.agent_id, c.channel, c.direction, c.erased_at is not null as erased, c.end_reason,
            case when c.direction = 'outbound' then c.to_e164 else c.from_e164 end as caller,
            a.drop_follow_up as mode, a.drop_follow_up_message as message, a.language
       from calls c left join agents a on a.id = c.agent_id
      where c.id = $1 for update of c`,
    [callId],
  );
  // A chamada pode ter sumido entre o fim e a revisão (outra organização, ou apagada): nada a fazer,
  // e a fila segue. Apagada a pedido do titular, também não: a pendência traria o número de volta.
  if (!call || call.erased) return "skipped";
  // O modo do agente que atendeu (`calls.agent_id`), e não a soma dos agentes por onde a ligação
  // passou. Agente apagado depois da ligação vale `off`, o de antes.
  const mode: DropFollowUpMode = call.mode ?? "off";
  const simulated = call.channel === "simulated";
  // A simulada é teste de quem configura, não ligação de alguém (a mesma regra da #291): nunca abre
  // pendência. Com o modo ligado, ela só grava o que teria acontecido. Sem número, não há a quem retornar.
  if (simulated && mode === "off") return "skipped";
  if (!simulated && call.caller === null) return "skipped";
  if (!simulated && (await q.one("select 1 from follow_ups where call_id = $1 and source = 'review_call'", [callId]))) return "already_reviewed";
  // O modo `whatsapp` pode agir sem abrir pendência (a mensagem saiu, ou o número está na lista de não
  // ligar): o evento é o que marca a revisão feita, e repetir a tarefa não manda a segunda mensagem.
  if (await q.one("select 1 from call_events where call_id = $1 and kind = 'drop_follow_up'", [callId])) return "already_reviewed";

  const events = await q.many<ReviewEvent>(
    `select kind,
            case when kind = 'tool_result' then payload->>'name' end as name,
            case when kind = 'tool_result' and jsonb_typeof(payload->'ok') = 'boolean' then (payload->>'ok')::boolean end as ok,
            case when kind = 'call_refused' then payload->>'reason' end as reason,
            case when kind in ('approval_requested', 'approval_decided') then payload->>'approvalId' end as "approvalId"
       from call_events
      where call_id = $1 and kind in ('engine_failed', 'call_refused', 'voicemail_left', 'tool_result', 'follow_up_created', 'human_notified', 'approval_requested', 'approval_decided', 'transfer_started', 'call_answered')
      order by id`,
    [callId],
  );
  // Só os campos estáveis de `call_ended`, como os outros: a vez aberta no instante do desligar e se
  // quem ligou falou depois do último "pode repetir?".
  const ended = await q.one<{ open_turn: unknown; spoke_after_ask: unknown }>(
    "select payload->'openTurn' as open_turn, payload->'callerSpokeAfterAsk' as spoke_after_ask from call_events where call_id = $1 and kind = 'call_ended' order by id desc limit 1",
    [callId],
  );
  const openTurn = openTurnOf(ended?.open_turn);
  // A condição 2(c) só olha o fato da sessão, o tipo dos eventos de vez e o `action` do pedido, nunca o
  // texto. "Quem ligou não falou mais" é `callerSpokeAfterAsk` igual a `false`: a falta de
  // `transcript_user` não prova, porque a última fala antes do desligar costuma não virar transcrição.
  // O campo ausente (ligação gravada antes dele, ou sem pedido) não vale.
  const afterAsk =
    call.end_reason === "caller_hangup" &&
    openTurn === null &&
    ended?.spoke_after_ask === false &&
    hungUpAfterAsk(
      await q.many<TurnEvent>(
        `select kind, case when kind = 'caller_unanswered' then payload->>'action' end as action
           from call_events
          where call_id = $1 and kind in ('caller_unanswered', 'transcript_user', 'transcript_agent')
          order by at, id`,
        [callId],
      ),
    );
  const found = reviewCaseOf(events, call.end_reason, { direction: call.direction, openTurn, afterAsk });
  // Em `off`, o caso 5 não faz nada: a revisão é a de antes da fatia.
  if (found === null || (found === "call_dropped" && mode === "off")) return "no_case";
  // `drop_follow_up` só para a ligação recebida e atendida (seção 2, condição 1): a recusa antes de
  // atender e a ligação feita seguem só no caso 1 de sempre, sem o evento.
  const answeredInbound = call.direction === "inbound" && events.some((event) => event.kind === "call_answered");
  const dropped = DROP_CASES.has(found) && mode !== "off" && answeredInbound;
  // Pela condição 2(c), a leitura da revisão é a de quem esperava; o `call_ended` continua `null`.
  const report = (outcome: { action: DropFollowUpAction; reason?: DropFollowUpSkip }): Promise<void> => {
    const payload: DropFollowUpPayload = {
      case: found as DropFollowUpPayload["case"],
      mode: mode as DropFollowUpPayload["mode"],
      action: outcome.action,
      ...(outcome.reason !== undefined && { reason: outcome.reason }),
      simulated,
      openTurn: found === "call_dropped" && afterAsk ? "caller_waiting" : openTurn,
    };
    return recordEvent(q, callId, "drop_follow_up", payload, now);
  };
  // `task` abre a pendência. `whatsapp` confere o pré-requisito, a lista e o limite na hora de agir.
  // `call_back` ainda não tem caminho (fatias 3 e 4) e a rota não o aceita; gravado direto no banco,
  // cai na reserva, que é a pendência.
  const outcome = dropped && mode === "whatsapp" ? await whatsAppAction(q, call.caller, now) : { action: "task_opened" as const };
  if (simulated) {
    if (!dropped) return "skipped";
    await report(outcome);
    return "simulated";
  }
  const caller = call.caller;
  if (caller === null) return "skipped";
  if (outcome.action === "whatsapp_queued") {
    // O caminho dos avisos (seção 3.5): uma linha em `notifications` e a tarefa `deliver_notification`
    // de sempre. O corpo é o texto fixo do agente, ou o padrão do sistema na língua dele; nada da
    // conversa entra, e a revisão nem lê a transcrição.
    const body = call.message ?? dropFollowUpDefaultMessage(call.language);
    const notice = await q.one<{ id: string }>(
      "insert into notifications (organization_id, call_id, channel, audience, target, body, created_at) values ($1, $2, 'whatsapp', 'caller', $3, $4, $5) returning id",
      [q.organizationId, callId, caller, body, now],
    );
    if (!notice) throw new Error(`Caller message for call ${callId} was not created`);
    await enqueueTask(q, { kind: "deliver_notification", payload: { notificationId: notice.id }, callId, runAt: now });
    await report(outcome);
    return "messaged";
  }
  // A pessoa pediu para não ser procurada: nem mensagem, nem pendência para alguém retornar.
  if (outcome.reason === "do_not_call") {
    await report(outcome);
    return "do_not_call";
  }
  await createFollowUp(
    q,
    { callId, agentId: call.agent_id, title: reviewTitle(caller, found), details: reviewDetails(found, events.some((event) => event.kind === "transfer_started")), dueAt: now, origin: { source: "review_call", case: found } },
    now,
  );
  if (dropped) await report(outcome);
  return "opened";
}

/**
 * A entrega da mensagem para quem ligou (`notifications.audience = 'caller'`) terminou: grava o
 * resultado na ligação original (`drop_follow_up_result`, seção 3.7) e, se ela não saiu, abre a
 * pendência de reserva, a mesma do supervisor (`source = 'review_call'`, uma por ligação). Chamada por
 * `deliver_notification` no envio que sai e na última tentativa que falha, na transação de `q`.
 *
 * Repetir não grava de novo nem abre a segunda pendência. Ligação apagada a pedido do titular não
 * recebe pendência: ela traria o número de volta.
 */
export async function recordCallerMessageResult(q: OrgQuery, callId: string, action: DropFollowUpResultPayload["action"], now: Date): Promise<void> {
  const { erased } = await lockCall(q, callId);
  if (await q.one("select 1 from call_events where call_id = $1 and kind = 'drop_follow_up_result'", [callId])) return;
  await recordEvent(q, callId, "drop_follow_up_result", { action } satisfies DropFollowUpResultPayload, now);
  if (action !== "whatsapp_failed" || erased) return;
  const call = await q.one<{ agent_id: string | null; caller: string | null }>("select agent_id, from_e164 as caller from calls where id = $1", [callId]);
  if (!call?.caller) return;
  if (await q.one("select 1 from follow_ups where call_id = $1 and source = 'review_call'", [callId])) return;
  await createFollowUp(
    q,
    { callId, agentId: call.agent_id, title: callerMessageFailedTitle(call.caller), details: CALLER_MESSAGE_FAILED_DETAILS, dueAt: now, origin: { source: "review_call", case: "caller_message_failed" } },
    now,
  );
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
