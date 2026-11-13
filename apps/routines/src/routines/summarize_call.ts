import { enqueueTask, withOrg, type CallStatus, type OrgQuery } from "@deskvoice/core";
import { hasWhatsAppConnector } from "@deskvoice/tools";
import type { Routine } from "../types";

export interface CallDigest {
  status: CallStatus;
  endReason: string | null;
  turns: { speaker: "user" | "agent"; text: string }[];
  toolsUsed: string[];
}

const OUTCOME: Record<CallStatus, string> = {
  ringing: "ainda tocando",
  in_progress: "ainda em andamento",
  transferred: "transferida para um humano",
  completed: "concluída",
  failed: "falhou",
  refused: "recusada",
};
const EDGE_TURNS = 3;
const MAX_TURN_CHARS = 200;

const line = (turn: CallDigest["turns"][number]): string => {
  const text = turn.text.length > MAX_TURN_CHARS ? `${turn.text.slice(0, MAX_TURN_CHARS)}…` : turn.text;
  return `${turn.speaker === "user" ? "Cliente" : "Agente"}: ${text}`;
};

/**
 * Resumo extrativo e determinístico: desfecho, primeiras e últimas falas, ferramentas usadas.
 *
 * Ponto de extensão: um resumo escrito por LLM entra aqui, como outra função `(digest) => texto`
 * escolhida por configuração da organização. O `CallDigest` já é a entrada que ela precisa.
 */
export function extractiveSummary(digest: CallDigest): string {
  const parts = [`Desfecho: ${OUTCOME[digest.status]}${digest.endReason ? ` (${digest.endReason})` : ""}.`];
  if (digest.turns.length === 0) {
    parts.push("Sem falas transcritas.");
  } else if (digest.turns.length <= EDGE_TURNS * 2) {
    parts.push("Conversa:", ...digest.turns.map(line));
  } else {
    parts.push("Começo da conversa:", ...digest.turns.slice(0, EDGE_TURNS).map(line));
    parts.push(`Fim da conversa (${digest.turns.length} falas no total):`, ...digest.turns.slice(-EDGE_TURNS).map(line));
  }
  if (digest.toolsUsed.length > 0) parts.push(`Ferramentas usadas: ${digest.toolsUsed.join(", ")}.`);
  return parts.join("\n");
}

/** Quem recebe o resumo: o dono, ou o primeiro admin, com WhatsApp cadastrado. */
async function ownerToNotify(q: OrgQuery): Promise<string | null> {
  const row = await q.one<{ whatsapp_e164: string }>(
    `select whatsapp_e164 from users
      where role in ('owner', 'admin') and whatsapp_e164 is not null
      order by case when role = 'owner' then 0 else 1 end, created_at
      limit 1`,
  );
  return row?.whatsapp_e164 ?? null;
}

/**
 * Manda o resumo da ligação para o WhatsApp de quem opera a instalação.
 *
 * Só avisa quando há como avisar: conector de WhatsApp configurado E alguém com número
 * cadastrado. Faltando qualquer um dos dois, o resumo fica só no painel — é o estado de
 * toda instalação nova, e transformar isso numa tarefa que falha três vezes não ajudaria
 * ninguém.
 *
 * `owner_notified_at` é o cadeado: a fila reexecuta `summarize_call`, e quem ganha o
 * `update` condicional é quem cria o aviso. Sem ele, um retry vira mensagem repetida no
 * WhatsApp do dono — e o WhatsApp não tem desfazer.
 */
async function notifyOwner(q: OrgQuery, callId: string, summary: string): Promise<void> {
  if (!(await hasWhatsAppConnector(q))) return;
  const target = await ownerToNotify(q);
  if (target === null) return;
  const claimed = await q.one<{ id: string }>(
    "update calls set owner_notified_at = now() where id = $1 and owner_notified_at is null returning id",
    [callId],
  );
  if (!claimed) return;
  const call = await q.one<{ from_e164: string | null }>("select from_e164 from calls where id = $1", [callId]);
  const from = call?.from_e164 ? ` de ${call.from_e164}` : "";
  const notification = await q.one<{ id: string }>(
    "insert into notifications (organization_id, call_id, channel, target, body) values ($1, $2, 'whatsapp', $3, $4) returning id",
    [q.organizationId, callId, target, `Resumo da ligação${from}:\n\n${summary}`],
  );
  if (!notification) throw new Error(`Notification for call ${callId} was not created`);
  await enqueueTask(q, { kind: "deliver_notification", payload: { notificationId: notification.id }, callId });
}

const routine: Routine = {
  kind: "summarize_call",
  async run(task, deps) {
    const { callId } = task;
    if (callId === null) throw new Error("summarize_call needs a task with callId");
    await withOrg(deps.db, task.organizationId, async (q) => {
      const call = await q.one<{ status: CallStatus; end_reason: string | null }>("select status, end_reason from calls where id = $1", [callId]);
      if (!call) throw new Error(`Call ${callId} not found`);
      const events = await q.many<{ kind: string; text: string | null; name: string | null }>(
        `select kind, payload->>'text' as text, payload->>'name' as name from call_events
          where call_id = $1 and kind in ('transcript_user', 'transcript_agent', 'tool_called') order by id`,
        [callId],
      );
      const turns = events.flatMap((event) =>
        event.kind !== "tool_called" && event.text ? [{ speaker: event.kind === "transcript_user" ? ("user" as const) : ("agent" as const), text: event.text }] : [],
      );
      const toolsUsed = [...new Set(events.flatMap((event) => (event.kind === "tool_called" && event.name ? [event.name] : [])))];
      const summary = extractiveSummary({ status: call.status, endReason: call.end_reason, turns, toolsUsed });
      await q.exec("update calls set summary = $2 where id = $1", [callId, summary]);
      await notifyOwner(q, callId, summary);
    });
  },
};

export default routine;
