import { readFile, stat } from "node:fs/promises";
import {
  MAX_TASK_ATTEMPTS,
  TRANSCRIPT_RETENTION_SETTING,
  decryptSecret,
  enqueueTask,
  lockCall,
  recordEvent,
  recordingPath,
  SPEND_CAP_REACHED,
  spendCapReached,
  transcriptRetentionOf,
  withOrg,
  type ClaimedTask,
  type OrgQuery,
} from "@deskvoice/core";
import {
  AUTO_TRANSCRIPTION_SETTING,
  MICROCENTS_PER_CENT,
  TRANSCRIPTION_SETTING,
  autoTranscriptionEnabledOf,
  loadEngines,
  transcriptionEnabledOf,
  type RecordingTranscriber,
  type TranscribeResult,
} from "@deskvoice/voice-engine";
// Pelo caminho do arquivo, como no painel: o índice do pacote carrega a descoberta por pasta.
import { recordingSideEstimate, splitRecording } from "@deskvoice/voice-engine/transcription";
import type { Routine, RoutineDeps } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** O mesmo código de recusa do botão manual, para a linha do tempo dizer o motivo com uma frase só. */
const TOO_LONG = "transcription_too_long";
type Speaker = "caller" | "agent";
const KIND: Record<Speaker, "transcript_user" | "transcript_agent"> = {
  caller: "transcript_user",
  agent: "transcript_agent",
};

/**
 * A chamada já tem alguma fala na linha do tempo, de qualquer fonte. A mesma régua do botão manual
 * (`spokenOf` da rota de transcrição): fala vazia não conta.
 */
export async function hasSpeech(q: OrgQuery, callId: string): Promise<boolean> {
  const row = await q.one<{ n: number }>(
    "select count(*)::int as n from call_events where call_id = $1 and kind in ('transcript_user', 'transcript_agent') and coalesce(payload->>'text', '') <> ''",
    [callId],
  );
  return (row?.n ?? 0) > 0;
}

interface Pending {
  engineId: string;
  transcriber: RecordingTranscriber;
  /** A chave como está no banco, cifrada: o claro só existe na memória, na hora do pedido. */
  stored: string;
  sides: Array<{ speaker: Speaker; audio: Uint8Array }>;
  seconds: number;
  language: string;
  /** O horário das falas: o do fim da chamada, para o prazo de guarda alcançar o texto. */
  at: Date;
}

/**
 * Transcreve a gravação de uma chamada que terminou sem texto — o recado da caixa postal, a ligação
 * em que o motor em tempo real não deu conta, ou a que caiu no meio.
 *
 * Roda **antes** de `summarize_call` (é este quem enfileira), e por isso o resumo, o desfecho e o
 * aviso ao dono já saem com o texto no lugar do vazio. Sem a transcrição, quem abre o painel no dia
 * seguinte encontra um áudio que ninguém ouve e uma linha do tempo sem uma palavra do que a pessoa
 * pediu.
 *
 * Desligada de fábrica: exige `calls.auto_transcription_enabled` e também `calls.transcription_enabled`,
 * a licença para o áudio gravado sair da instalação para o provedor do motor. Cada transcrição é paga.
 * Faltando uma das duas, esta rotina apenas passa a tarefa adiante.
 *
 * Nunca lança por falha do provedor: a fila reexecuta, e reexecutar pagaria de novo pelo mesmo áudio.
 * O motivo fica na linha do tempo, sem áudio e sem fala.
 */
const routine: Routine = {
  kind: "transcribe_call",
  async run(task, deps) {
    try {
      await transcribe(task, deps);
    } catch (cause) {
      // Com as tentativas esgotadas, o resumo que esta rotina enfileiraria no fim não sai, e com ele
      // o aviso ao dono e o desfecho, que esperavam esta segunda passada: a ligação terminaria sem
      // ninguém saber dela. Na última tentativa, o resumo vai para a fila mesmo assim, sem o texto.
      // Nas anteriores não: a próxima pode dar certo, e o aviso sairia antes do texto.
      if (task.attempts >= MAX_TASK_ATTEMPTS && task.callId !== null) {
        const callId = task.callId;
        await withOrg(deps.db, task.organizationId, (q) => enqueueTask(q, { kind: "summarize_call", payload: {}, callId, runAt: deps.clock.now() }));
      }
      throw cause;
    }
  },
};

async function transcribe(task: ClaimedTask, deps: RoutineDeps): Promise<void> {
  const callId = task.callId;
  if (callId === null) throw new Error("transcribe_call needs a task with callId");
  const engines = await loadEngines();

  const pending = await withOrg(deps.db, task.organizationId, async (q): Promise<Pending | null> => {
    const settings = await q.many<{ key: string; value: unknown }>("select key, value from settings where key = any($1)", [
      [TRANSCRIPTION_SETTING, AUTO_TRANSCRIPTION_SETTING, TRANSCRIPT_RETENTION_SETTING],
    ]);
    // Desligadas de fábrica. A tarefa pode ter entrado na fila antes de alguém desligar: confere de novo.
    const valueOf = (key: string): unknown => settings.find((row) => row.key === key)?.value;
    if (!transcriptionEnabledOf(valueOf(TRANSCRIPTION_SETTING)) || !autoTranscriptionEnabledOf(valueOf(AUTO_TRANSCRIPTION_SETTING))) return null;

    const call = await q.one<{ agent_id: string | null; started_at: Date; ended_at: Date | null; cost_cents: number }>(
      "select agent_id, started_at, ended_at, cost_cents from calls where id = $1",
      [callId],
    );
    if (!call) throw new Error(`Call ${callId} not found in this organization`);
    if (call.agent_id === null) return null;

    const now = deps.clock.now();
    const retention = transcriptRetentionOf(valueOf(TRANSCRIPT_RETENTION_SETTING));
    // O mesmo corte do expurgo: chamada fora do prazo não ganha texto que já deveria ter sido apagado.
    if (retention !== null && call.started_at.getTime() < now.getTime() - retention * DAY_MS) return null;

    // Já existe fala, de qualquer fonte: a do tempo real não grava `source`, a da gravação grava
    // `stt`. Transcrever de novo pagaria pela conversa que já está na linha do tempo, em dobro.
    if (await hasSpeech(q, callId)) return null;

    const agent = await q.one<{ engine: string; cost_ceiling_cents: number; language: string }>(
      "select engine, cost_ceiling_cents, language from agents where id = $1",
      [call.agent_id],
    );
    if (!agent) return null;

    const transcriber = engines.get(agent.engine)?.transcription;
    if (!transcriber) {
      await recordEvent(q, callId, "transcription_failed", { reason: "engine_cannot_transcribe", engine: agent.engine }, now);
      return null;
    }
    // O teto continua sendo o mesmo número do resto do produto: não gastar além do que o dono autorizou.
    if (agent.cost_ceiling_cents > 0 && call.cost_cents >= agent.cost_ceiling_cents) {
      await recordEvent(q, callId, "transcription_failed", { reason: "cost_ceiling", engine: agent.engine }, now);
      return null;
    }
    // O teto do mês da organização, pelo mesmo caminho das portas da ligação: no teto, nada vai ao provedor.
    const cap = await spendCapReached(q, now);
    if (cap.reached) {
      await recordEvent(q, callId, "transcription_failed", { reason: SPEND_CAP_REACHED, engine: agent.engine, capCents: cap.capCents }, now);
      return null;
    }

    const stored = await q.one<{ value: unknown }>("select value from settings where key = $1", [`engine.${agent.engine}.api_key`]);
    if (typeof stored?.value !== "string" || stored.value === "") {
      await recordEvent(q, callId, "transcription_failed", { reason: "no_key", engine: agent.engine }, now);
      return null;
    }

    if (deps.recordingsDir === undefined) return null;
    const recording = recordingPath(deps.recordingsDir, task.organizationId, callId);
    // Sem gravação não há o que transcrever, e isso não é falha: a chamada só não foi gravada.
    const fileBytes = await stat(recording).then((info) => info.size).catch(() => null);
    if (fileBytes === null) return null;
    // A mesma conta do botão manual, antes do `readFile`: gravação que não cabe num pedido do
    // provedor não é carregada na memória, e esta rotina roda sozinha em toda chamada sem texto.
    const estimate = recordingSideEstimate(fileBytes);
    if (estimate && estimate.sideBytes > transcriber.maxAudioBytes) {
      await recordEvent(q, callId, "transcription_failed", { reason: TOO_LONG, engine: agent.engine }, now);
      return null;
    }
    const wav = await readFile(recording).catch(() => null);
    if (wav === null) return null;
    const sides = splitRecording(wav);
    if (sides === null || sides.caller === null || sides.agent === null) {
      await recordEvent(q, callId, "transcription_failed", { reason: "unreadable_recording", engine: agent.engine }, now);
      return null;
    }
    // Um pedido do provedor por lado: acima do limite dele, o pedido nem sai.
    if (sides.sideBytes > transcriber.maxAudioBytes) {
      await recordEvent(q, callId, "transcription_failed", { reason: TOO_LONG, engine: agent.engine }, now);
      return null;
    }

    if (await lockCall(q, callId).then((row) => row.erased)) return null;

    return {
      engineId: agent.engine,
      transcriber,
      stored: stored.value,
      sides: [
        { speaker: "caller", audio: sides.caller },
        { speaker: "agent", audio: sides.agent },
      ],
      seconds: sides.seconds,
      language: agent.language,
      at: call.ended_at ?? call.started_at,
    };
  });

  if (pending !== null) {
    // Fora da transação: o provedor leva até trinta segundos, e segurar a transação aberta travaria a fila.
    const apiKey = decryptSecret(pending.stored, deps.secretKey);
    const results: Array<{ speaker: Speaker; result: TranscribeResult }> = [];
    for (const side of pending.sides) {
      results.push({
        speaker: side.speaker,
        result: await pending.transcriber.transcribe(apiKey, { audio: side.audio, seconds: pending.seconds, language: pending.language }, { fetch: deps.fetch }),
      });
    }

    await withOrg(deps.db, task.organizationId, async (q) => {
      const now = deps.clock.now();
      // Apagamento a pedido do titular que confirmou durante a espera: nada de texto novo.
      if ((await lockCall(q, callId)).erased) return;

      // O consumo entra no extrato mesmo sem texto: o provedor cobrou. Chamada apagada já saiu daqui.
      const input = results.reduce((sum, { result }) => sum + (result.usage.inputTokens ?? 0) + (result.usage.textInputTokens ?? 0) + (result.usage.cachedInputTokens ?? 0), 0);
      const output = results.reduce((sum, { result }) => sum + (result.usage.outputTokens ?? 0) + (result.usage.textOutputTokens ?? 0), 0);
      const cents = results.reduce((sum, { result }) => sum + result.costCents, 0);
      if (input > 0 || output > 0 || cents > 0) {
        await q.exec(
          "insert into usage_ledger (organization_id, call_id, engine, input_tokens, output_tokens, cost_cents, cost_microcents, at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
          [q.organizationId, callId, pending.engineId, input, output, cents, Math.round(cents * MICROCENTS_PER_CENT), now],
        );
        await q.exec("update calls set cost_cents = cost_cents + $2 where id = $1", [callId, cents]);
      }

      const spoken = results.filter((row): row is { speaker: Speaker; result: Extract<TranscribeResult, { ok: true }> } => row.result.ok && row.result.text !== "");
      if (spoken.length === 0) {
        const failed = results.find(({ result }) => !result.ok)?.result;
        const payload = failed && !failed.ok
          ? { reason: failed.failure, status: failed.status, engine: pending.engineId, model: pending.transcriber.model }
          : { reason: "no_speech", engine: pending.engineId, model: pending.transcriber.model };
        await recordEvent(q, callId, "transcription_failed", payload, now);
        return;
      }
      for (const turn of spoken) {
        await recordEvent(q, callId, KIND[turn.speaker], { text: turn.result.text, source: "stt", engine: pending.engineId, model: pending.transcriber.model, transcribedAt: now.toISOString() }, pending.at);
      }
    });
  }

  // O resumo (e, atrás dele, o desfecho e o aviso ao dono) roda depois do texto existir. Sem texto,
  // é o resumo de sempre — o mesmo que aconteceria sem esta rotina.
  await withOrg(deps.db, task.organizationId, (q) => enqueueTask(q, { kind: "summarize_call", payload: {}, callId, runAt: deps.clock.now() }));
}

export default routine;
