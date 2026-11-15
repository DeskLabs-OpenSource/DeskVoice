import { enqueueTask, withOrg, type CallStatus, type OrgQuery } from "@deskvoice/core";
import { hasWhatsAppConnector } from "@deskvoice/tools";
import {
  ANALYSIS_SETTING,
  AUTO_TRANSCRIPTION_SETTING,
  OUTCOME_SETTING,
  TRANSCRIPTION_SETTING,
  analysisEnabledOf,
  autoTranscriptionEnabledOf,
  outcomeEnabledOf,
  transcriptionEnabledOf,
} from "@deskvoice/voice-engine";
import type { Routine } from "../types";
import { hasSpeech } from "./transcribe_call";

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

// Liga o aviso em Configurações → WhatsApp. Ausente vale desligado.
export const OWNER_NOTICE_SETTING = "whatsapp.notify_owner_on_call_end";
// O WhatsApp é um canal fora da instalação: corpo fixo, sem fala e sem número de quem ligou (a mesma
// regra do `WHATSAPP_BODY` de `follow_up.ts`). O resumo fica no painel.
export const OWNER_NOTICE_BODY = "Uma ligação terminou. O resumo está no painel do DeskVoice";

/**
 * Avisa pelo WhatsApp quem opera a instalação de que uma ligação terminou.
 *
 * Só avisa com o aviso ligado na tela, conector de WhatsApp configurado e alguém com número
 * cadastrado. Faltando qualquer um, nada acontece: o resumo fica só no painel.
 *
 * `owner_notified_at` é o cadeado: a fila reexecuta `summarize_call`, e quem ganha o
 * `update` condicional é quem cria o aviso. Sem ele, um retry vira mensagem repetida no
 * WhatsApp do dono — e o WhatsApp não tem desfazer.
 */
async function notifyOwner(q: OrgQuery, callId: string, now: Date): Promise<void> {
  const enabled = await q.one<{ value: unknown }>("select value from settings where key = $1", [OWNER_NOTICE_SETTING]);
  if (enabled?.value !== true || !(await hasWhatsAppConnector(q))) return;
  const target = await ownerToNotify(q);
  if (target === null) return;
  const claimed = await q.one<{ id: string }>("update calls set owner_notified_at = $2 where id = $1 and owner_notified_at is null returning id", [callId, now]);
  if (!claimed) return;
  const notification = await q.one<{ id: string }>(
    "insert into notifications (organization_id, call_id, channel, target, body, created_at) values ($1, $2, 'whatsapp', $3, $4, $5) returning id",
    [q.organizationId, callId, target, OWNER_NOTICE_BODY, now],
  );
  if (!notification) throw new Error(`Notification for call ${callId} was not created`);
  await enqueueTask(q, { kind: "deliver_notification", payload: { notificationId: notification.id }, callId, runAt: now });
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
      // Chamada apagada a pedido do titular não recebe resumo, aviso nem desfecho. O `update` trava a
      // linha: se o apagamento confirmou depois da leitura das falas acima, nada é escrito.
      const written = await q.exec("update calls set summary = $2 where id = $1 and erased_at is null", [callId, summary]);
      if (written === 0) return;
      const settings = await q.many<{ key: string; value: unknown }>("select key, value from settings where key = any($1)", [
        [OUTCOME_SETTING, ANALYSIS_SETTING, TRANSCRIPTION_SETTING, AUTO_TRANSCRIPTION_SETTING],
      ]);
      const valueOf = (key: string): unknown => settings.find((row) => row.key === key)?.value;
      // A chamada terminou sem fala nenhuma e a transcrição automática está ligada (ela e a licença do
      // áudio sair, `calls.transcription_enabled`): a gravação vai para a fila agora, e o desfecho
      // espera, com o aviso ao dono. É a transcrição quem enfileira este resumo de novo, com o texto no
      // lugar do vazio, e os dois saem dessa segunda passada: classificar antes pagaria por uma
      // conversa vazia, e avisar antes mandaria o dono a um resumo sem fala.
      // A existência da própria tarefa é a marca de "já pedi": sem isso, chamada sem fala nenhuma
      // faria o resumo e a transcrição se reenfileirarem para sempre.
      if (transcriptionEnabledOf(valueOf(TRANSCRIPTION_SETTING)) && autoTranscriptionEnabledOf(valueOf(AUTO_TRANSCRIPTION_SETTING))) {
        const asked = await q.one<{ n: number }>("select count(*)::int as n from tasks where call_id = $1 and kind = 'transcribe_call'", [callId]);
        if ((asked?.n ?? 0) === 0 && !(await hasSpeech(q, callId))) {
          await enqueueTask(q, { kind: "transcribe_call", payload: {}, callId });
          return;
        }
      }
      await notifyOwner(q, callId, deps.clock.now());
      // O desfecho comercial e a análise são do motor do agente, na mesma rotina e na mesma chamada
      // paga: vão para a fila em separado, para o resumo não depender de provedor nenhum para ficar
      // pronto. As duas desligadas (de fábrica), nem entra na fila.
      const outcomeOn = outcomeEnabledOf(valueOf(OUTCOME_SETTING));
      const analysisOn = analysisEnabledOf(valueOf(ANALYSIS_SETTING));
      if (outcomeOn || analysisOn) await enqueueTask(q, { kind: "classify_call_outcome", payload: {}, callId });
    });
  },
};

export default routine;
