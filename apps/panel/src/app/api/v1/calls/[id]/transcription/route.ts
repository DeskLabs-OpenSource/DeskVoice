import { readFile } from "node:fs/promises";
import { TRANSCRIPT_RETENTION_SETTING, decryptSecret, enqueueTask, lockCall, recordEvent, recordingPath, transcriptRetentionOf, type OrgQuery } from "@deskvoice/core";
// Pelo caminho do arquivo: o índice do pacote carrega a descoberta por pasta, que não existe no Next.
import { MICROCENTS_PER_CENT } from "@deskvoice/voice-engine/pricing";
import { splitRecording } from "@deskvoice/voice-engine/transcription";
import { TRANSCRIPTION_SETTING, transcriptionEnabledOf, type RecordingTranscriber, type TranscribeResult } from "@deskvoice/voice-engine/types";
import { ApiError, handle, notFound } from "../../../../../../server/context";
import { engineKeySetting, listEngines } from "../../../../../../server/pieces";

const DAY_MS = 24 * 60 * 60 * 1000;

type Speaker = "user" | "agent";
interface Turn {
  speaker: Speaker;
  text: string;
}
interface Reply {
  cached: boolean;
  turns: Turn[];
}
interface Pending {
  engineId: string;
  transcriber: RecordingTranscriber;
  /** A chave como está no banco, cifrada. O claro só existe na memória, na hora do pedido. */
  stored: string;
  sides: Array<{ speaker: Speaker; audio: Uint8Array }>;
  seconds: number;
  language: string;
  /** O horário das falas: o do fim da chamada, para o prazo de guarda alcançar o texto junto com o resto dela. */
  at: Date;
}

const KIND: Record<Speaker, "transcript_user" | "transcript_agent"> = { user: "transcript_user", agent: "transcript_agent" };

/**
 * A chamada pode ganhar texto agora? Conferido antes do pedido ao provedor e de novo na transação
 * que grava, com a linha travada por `lockCall`: apagamento ou prazo que mudem durante a espera
 * pelo provedor alcançam a escrita.
 */
async function refusal(q: OrgQuery, callId: string, startedAt: Date, now: Date): Promise<ApiError | null> {
  if ((await lockCall(q, callId)).erased) return new ApiError(409, "transcription_call_erased", "This call was erased at the data subject's request and gets no new text.");
  const retention = transcriptRetentionOf((await q.one<{ value: unknown }>("select value from settings where key = $1", [TRANSCRIPT_RETENTION_SETTING]))?.value);
  // O mesmo corte do expurgo (`purge_transcripts`): chamada que começou antes dele já perdeu o texto.
  if (retention !== null && startedAt.getTime() < now.getTime() - retention * DAY_MS) {
    return new ApiError(409, "transcription_outside_retention", "This call is older than the transcript retention period and gets no new text.");
  }
  return null;
}

/** As falas com texto da chamada, e se cada uma veio desta rota (`source: "stt"`). */
const spokenOf = (q: OrgQuery, callId: string) =>
  q.many<{ kind: string; text: string; stt: boolean }>(
    `select kind, payload->>'text' as text, coalesce(payload->>'source' = 'stt', false) as stt from call_events
      where call_id = $1 and kind in ('transcript_user', 'transcript_agent') and coalesce(payload->>'text', '') <> '' order by id`,
    [callId],
  );

const turnsOf = (rows: Array<{ kind: string; text: string }>): Turn[] => rows.map((row) => ({ speaker: row.kind === "transcript_user" ? "user" : "agent", text: row.text }));

/**
 * Transcreve a gravação de uma chamada que ficou sem texto (recado, motor que falhou, chamada sem
 * motor), um lado por vez: o canal de quem ligou vira `transcript_user`, o do agente vira
 * `transcript_agent`, os dois com `source: "stt"`.
 *
 * Desligado de fábrica (`calls.transcription_enabled`) e só para quem configura: o áudio sai para o
 * provedor do motor e o pedido gasta com a chave da organização. Repetir devolve o texto já feito,
 * sem chamar o provedor. O custo entra no extrato e no custo da chamada, e o teto do agente vale.
 */
export const POST = handle(
  {
    configure: true,
    after: async (pending: Pending | Reply, { params, deps, org }): Promise<Reply> => {
      if (!("transcriber" in pending)) return pending;
      const callId = params.id ?? "";
      const apiKey = decryptSecret(pending.stored, deps.secretKey);
      // Fora da transação: o provedor leva segundos, e conexão do banco não espera por ele.
      const results: Array<{ speaker: Speaker; result: TranscribeResult }> = [];
      for (const side of pending.sides) {
        results.push({ speaker: side.speaker, result: await pending.transcriber.transcribe(apiKey, { audio: side.audio, seconds: pending.seconds, language: pending.language }, { fetch: deps.fetch }) });
      }

      const now = deps.clock.now();
      const outcome = await org(async (q): Promise<Reply | ApiError> => {
        const input = results.reduce((sum, { result }) => sum + (result.usage.inputTokens ?? 0) + (result.usage.textInputTokens ?? 0) + (result.usage.cachedInputTokens ?? 0), 0);
        const output = results.reduce((sum, { result }) => sum + (result.usage.outputTokens ?? 0) + (result.usage.textOutputTokens ?? 0), 0);
        const cents = results.reduce((sum, { result }) => sum + result.costCents, 0);
        // Sempre, mesmo somando zero: o `update` trava a linha da chamada até o commit, e um segundo
        // pedido simultâneo espera aqui e depois enxerga o texto deste (conferido abaixo).
        await q.exec("update calls set cost_cents = cost_cents + $2 where id = $1", [callId, cents]);
        // O que o provedor cobrou fica no extrato, com ou sem texto: foi gasto.
        if (input > 0 || output > 0 || cents > 0) {
          await q.exec("insert into usage_ledger (organization_id, call_id, engine, input_tokens, output_tokens, cost_cents, cost_microcents, at) values ($1, $2, $3, $4, $5, $6, $7, $8)", [
            q.organizationId,
            callId,
            pending.engineId,
            input,
            output,
            cents,
            // O preço da transcrição já vem em centavo inteiro; o micro-centavo dele é o mesmo valor,
            // para o extrato somar na unidade exata do resto e a classificação não perder a fração.
            Math.round(cents * MICROCENTS_PER_CENT),
            now,
          ]);
        }
        const failed = results.find(({ result }) => !result.ok)?.result;
        if (failed && !failed.ok) return new ApiError(502, "transcription_failed", `The provider did not transcribe the recording (${failed.failure}${failed.status === null ? "" : `, HTTP ${failed.status}`}).`);

        const call = await q.one<{ started_at: Date }>("select started_at from calls where id = $1", [callId]);
        if (!call) return notFound();
        const refused = await refusal(q, callId, call.started_at, now);
        if (refused) return refused;

        // Outro pedido gravou primeiro enquanto este esperava o provedor: vale o texto dele.
        const already = await spokenOf(q, callId);
        if (already.some((row) => row.stt)) return { cached: true, turns: turnsOf(already.filter((row) => row.stt)) };
        if (already.length > 0) return new ApiError(409, "transcription_has_text", "This call already has a transcript.");

        const turns = results.flatMap(({ speaker, result }) => (result.ok && result.text !== "" ? [{ speaker, text: result.text }] : []));
        if (turns.length === 0) return new ApiError(422, "transcription_no_speech", "The provider found no speech in the recording.");
        for (const turn of turns) {
          await recordEvent(q, callId, KIND[turn.speaker], { text: turn.text, source: "stt", engine: pending.engineId, model: pending.transcriber.model, transcribedAt: now.toISOString() }, pending.at);
        }
        // O resumo foi feito sem fala nenhuma: refeito com o texto novo (e, se ligado, o desfecho na sequência).
        await enqueueTask(q, { kind: "summarize_call", payload: {}, callId });
        return { cached: false, turns };
      });
      if (outcome instanceof ApiError) throw outcome;
      return outcome;
    },
  },
  async ({ q, params, deps }): Promise<Pending | Reply> => {
    const callId = params.id ?? "";
    const enabled = await q.one<{ value: unknown }>("select value from settings where key = $1", [TRANSCRIPTION_SETTING]);
    if (!transcriptionEnabledOf(enabled?.value)) {
      throw new ApiError(409, "transcription_disabled", "Recording transcription is off. Turn it on in Settings → Artificial intelligence.");
    }

    const call = await q.one<{ engine: string | null; agent_id: string | null; started_at: Date; ended_at: Date | null; cost_cents: number }>(
      "select engine, agent_id, started_at, ended_at, cost_cents from calls where id = $1",
      [callId],
    );
    if (!call) throw notFound();
    const now = deps.clock.now();
    const refused = await refusal(q, callId, call.started_at, now);
    if (refused) throw refused;

    const spoken = await spokenOf(q, callId);
    const done = spoken.filter((row) => row.stt);
    if (done.length > 0) return { cached: true, turns: turnsOf(done) };
    if (spoken.length > 0) throw new ApiError(409, "transcription_has_text", "This call already has a transcript.");

    const engine = (await listEngines()).find((candidate) => candidate.id === call.engine);
    const transcriber = engine?.transcription;
    if (!engine || !transcriber) throw new ApiError(409, "transcription_engine_unsupported", "The voice engine of this call does not transcribe recordings.");
    const stored = await q.one<{ value: unknown }>("select value from settings where key = $1", [engineKeySetting(engine.id)]);
    if (typeof stored?.value !== "string") throw new ApiError(409, "engine_not_configured", "The voice engine of this call has no key.");

    const agent = call.agent_id ? await q.one<{ cost_ceiling_cents: number; language: string }>("select cost_ceiling_cents, language from agents where id = $1", [call.agent_id]) : null;
    // O mesmo teto da voz e do desfecho: zero é "sem teto". Chegou nele, a chamada não gasta mais nada.
    // ponytail: confere o que já foi gasto, não o que a transcrição vai custar (centavos por minuto).
    if (agent && agent.cost_ceiling_cents > 0 && call.cost_cents >= agent.cost_ceiling_cents) {
      throw new ApiError(409, "transcription_cost_ceiling", "This call already reached the agent's cost ceiling.");
    }

    const wav = await readFile(recordingPath(deps.recordingsDir, q.organizationId, callId)).catch(() => null);
    if (!wav) throw new ApiError(404, "transcription_no_recording", "This call has no recording.");
    const sides = splitRecording(new Uint8Array(wav));
    if (!sides) throw new ApiError(422, "transcription_unreadable", "The recording is not the stereo file the recorder writes.");
    if (sides.sideBytes > transcriber.maxAudioBytes) {
      throw new ApiError(409, "transcription_too_long", `The recording is longer than the provider accepts in one request (about ${Math.floor((transcriber.maxAudioBytes / sides.sideBytes) * (sides.seconds / 60))} minutes).`);
    }
    const audio = [
      { speaker: "user" as const, audio: sides.caller },
      { speaker: "agent" as const, audio: sides.agent },
    ].flatMap((side) => (side.audio ? [{ speaker: side.speaker, audio: side.audio }] : []));
    if (audio.length === 0) throw new ApiError(422, "transcription_no_speech", "The recording is silent.");

    return { engineId: engine.id, transcriber, stored: stored.value, sides: audio, seconds: sides.seconds, language: agent?.language ?? "pt-BR", at: call.ended_at ?? call.started_at };
  },
);
