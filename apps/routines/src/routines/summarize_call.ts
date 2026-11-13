import { enqueueTask, withOrg, type CallStatus } from "@deskvoice/core";
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
      // O desfecho comercial é do motor do agente: vai para a fila em separado, para o resumo não
      // depender de provedor nenhum para ficar pronto.
      await enqueueTask(q, { kind: "classify_call_outcome", payload: {}, callId });
    });
  },
};

export default routine;
