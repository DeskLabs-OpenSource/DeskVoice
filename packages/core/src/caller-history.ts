import { ERASED_TEXT, callerSideSql } from "./erasures";
import { PURGED_SUMMARY_TEXT } from "./events";
import type { OrgQuery } from "./types";

/**
 * A memória do número para a equipe (fatia 2 do desenho de 13/11, registro 0020, item 1): o que a
 * organização já sabe sobre o telefone do outro lado de uma chamada. É só leitura do que a equipe já
 * vê na lista de Chamadas e em Pendências, mais as notas do agente (fatia 3), e nunca chega ao modelo:
 * quem lê são a tela da chamada e os avisos de `transfer_to_human` e `notify_human`, que nunca
 * mostram o texto das notas.
 *
 * A chave é (organização, telefone): o telefone é o do outro lado, pelo mesmo critério do apagamento
 * a pedido do titular (`callerSideSql`). Chamada sem número não lembra nem é lembrada.
 */

/** Quantas ligações anteriores, pendências abertas e notas a tela lista. A contagem é sempre a inteira. */
export const CALLER_HISTORY_LIMIT = 10;

export interface CallerHistoryCall {
  id: string;
  startedAt: Date;
  agentName: string | null;
  direction: "inbound" | "outbound";
  status: string;
  outcome: string | null;
  /** `null` quando a chamada foi apagada a pedido do titular, ou quando o resumo saiu com o prazo. */
  summary: string | null;
  summaryPurged: boolean;
  erased: boolean;
  /**
   * Chamada simulada (`channel = 'simulated'`): um teste da equipe, e não a pessoa ligando. A rota de
   * simular não pede papel, então qualquer pessoa da equipe pode simular com o número de um cliente.
   * A tela a lista com a marca "Simulada", e os avisos não a contam (`simulatedCallCount`).
   */
  simulated: boolean;
}

export interface CallerHistoryFollowUp {
  id: string;
  callId: string | null;
  title: string;
  dueAt: Date;
  ownerName: string | null;
  /** Nasceu numa chamada simulada. A criada pela tela, sem chamada, conta como real. */
  simulated: boolean;
}

/** Uma nota do agente sobre este número (`caller_notes`), com a ligação em que nasceu. */
export interface CallerHistoryNote {
  id: string;
  callId: string;
  text: string;
  createdAt: Date;
  /** Nasceu numa chamada simulada: a tela a marca, e os avisos nunca a contam. */
  simulated: boolean;
}

export interface CallerHistory {
  phone: string;
  /** Todas as ligações anteriores do número nesta organização; `calls` traz só as mais novas. */
  callCount: number;
  /** Quantas de `callCount` são simuladas. O aviso diz "já ligou" só com as outras. */
  simulatedCallCount: number;
  calls: CallerHistoryCall[];
  openFollowUpCount: number;
  /** Quantas de `openFollowUpCount` nasceram numa simulada. O aviso conta só as outras (#291). */
  simulatedOpenFollowUpCount: number;
  /** As reais primeiro, depois as de simulada; em cada grupo, pelo prazo. */
  openFollowUps: CallerHistoryFollowUp[];
  /** Todas as notas do número nesta organização; `notes` traz só as mais novas. */
  noteCount: number;
  /** Quantas de `noteCount` nasceram numa simulada. */
  simulatedNoteCount: number;
  notes: CallerHistoryNote[];
}

/**
 * As ligações anteriores à chamada `callId` do mesmo telefone, as pendências abertas e as notas do
 * agente sobre ele. O que nasceu numa chamada simulada vem marcado (`simulated`) e contado à parte:
 * a tela o mostra com a marca, e os avisos não o contam (#291). `null`
 * quando a chamada não existe nesta organização ou não tem número do outro lado.
 *
 * Só dentro de `withOrg`: a RLS é o que impede o mesmo número de trazer a ligação de outra
 * organização, e numa transação de sistema ela não vale.
 */
export async function callerHistory(q: OrgQuery, callId: string): Promise<CallerHistory | null> {
  if (q.organizationId === "") throw new Error("callerHistory runs inside withOrg, never withSystem: it would read every organization");
  const current = await q.one<{ phone: string | null; started_at: Date }>(
    "select case when direction = 'outbound' then to_e164 else from_e164 end as phone, started_at from calls where id = $1",
    [callId],
  );
  if (!current?.phone) return null;
  const phone = current.phone;

  // A apagada a pedido do titular perde o telefone (`eraseCaller`) e já não casa; a que ainda o tiver
  // aparece sem resumo, como a tela da chamada a mostra.
  const before = `${callerSideSql("c.")} and c.started_at < $2 and c.id <> $3`;
  const calls = await q.many<{
    id: string;
    started_at: Date;
    agent_name: string | null;
    direction: "inbound" | "outbound";
    status: string;
    outcome: string | null;
    summary: string | null;
    erased: boolean;
    simulated: boolean;
  }>(
    `select c.id, c.started_at, a.name as agent_name, c.direction, c.status, c.outcome,
            case when c.erased_at is null then c.summary end as summary, c.erased_at is not null as erased,
            c.channel = 'simulated' as simulated
       from calls c left join agents a on a.id = c.agent_id
      where ${before}
      order by c.started_at desc, c.id
      limit ${CALLER_HISTORY_LIMIT}`,
    [phone, current.started_at, callId],
  );
  const counted = await q.one<{ n: string; simulated: string }>(
    `select count(*) as n, count(*) filter (where c.channel = 'simulated') as simulated from calls c where ${before}`,
    [phone, current.started_at, callId],
  );
  const callCount = Number(counted?.n ?? 0);
  const simulatedCallCount = Number(counted?.simulated ?? 0);

  // A pendência apagada a pedido do titular fica sem telefone; o marcador no título é a defesa a mais.
  // A pendência sem chamada (criada pela tela) conta como real.
  const openWhere = "f.caller_e164 = $1 and f.status = 'open' and f.title <> $2";
  const followUpSimulated = "coalesce(oc.channel = 'simulated', false)";
  const followUps = await q.many<{ id: string; call_id: string | null; title: string; due_at: Date; owner_name: string | null; simulated: boolean }>(
    `select f.id, f.call_id, f.title, f.due_at, u.name as owner_name, ${followUpSimulated} as simulated
       from follow_ups f left join users u on u.id = f.owner_user_id left join calls oc on oc.id = f.call_id
      where ${openWhere}
      order by ${followUpSimulated}, f.due_at, f.id
      limit ${CALLER_HISTORY_LIMIT}`,
    [phone, ERASED_TEXT],
  );
  const followUpCounts = await q.one<{ n: string; simulated: string }>(
    `select count(*) as n, count(*) filter (where ${followUpSimulated}) as simulated from follow_ups f left join calls oc on oc.id = f.call_id where ${openWhere}`,
    [phone, ERASED_TEXT],
  );

  // As notas do número, de qualquer ligação dele (inclusive desta). O texto é dado: a tela o mostra
  // como texto puro, e nada daqui vai para aviso nem para o modelo.
  const notes = await q.many<{ id: string; call_id: string; text: string; created_at: Date; simulated: boolean }>(
    `select n.id, n.call_id, n.text, n.created_at, nc.channel = 'simulated' as simulated
       from caller_notes n join calls nc on nc.id = n.call_id
      where n.caller_e164 = $1
      order by n.created_at desc, n.id
      limit ${CALLER_HISTORY_LIMIT}`,
    [phone],
  );
  const noteCounts = await q.one<{ n: string; simulated: string }>(
    "select count(*) as n, count(*) filter (where nc.channel = 'simulated') as simulated from caller_notes n join calls nc on nc.id = n.call_id where n.caller_e164 = $1",
    [phone],
  );

  return {
    phone,
    callCount,
    simulatedCallCount,
    calls: calls.map((row) => {
      const summaryPurged = row.summary === PURGED_SUMMARY_TEXT;
      return {
        id: row.id,
        startedAt: row.started_at,
        agentName: row.agent_name,
        direction: row.direction,
        status: row.status,
        outcome: row.outcome,
        summary: summaryPurged ? null : row.summary,
        summaryPurged,
        erased: row.erased,
        simulated: row.simulated,
      };
    }),
    openFollowUpCount: Number(followUpCounts?.n ?? 0),
    simulatedOpenFollowUpCount: Number(followUpCounts?.simulated ?? 0),
    openFollowUps: followUps.map((row) => ({ id: row.id, callId: row.call_id, title: row.title, dueAt: row.due_at, ownerName: row.owner_name, simulated: row.simulated })),
    noteCount: Number(noteCounts?.n ?? 0),
    simulatedNoteCount: Number(noteCounts?.simulated ?? 0),
    notes: notes.map((row) => ({ id: row.id, callId: row.call_id, text: row.text, createdAt: row.created_at, simulated: row.simulated })),
  };
}
