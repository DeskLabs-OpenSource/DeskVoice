import { rm } from "node:fs/promises";
import { recordEvent, recordingPath, withOrg, type Clock, type Db } from "@deskvoice/core";
import { messageOf, silentLogger, type Logger } from "./log";
import { MIN_FREE_BYTES_TO_RECORD, freeBytes, startRecording, type Recording, type RecordingFailureReason } from "./recording";
import { SAMPLE_RATE, realSchedule, type CallTransport, type Schedule } from "./transport";

/**
 * Recado gravado quando ninguém pode atender (issue #166).
 *
 * Só entra onde a chamada seria recusada por falta de quem atenda (`no_agent`) ou por o agente
 * estar desligado (`agent_disabled`). No teto de ligações simultâneas a chamada continua recebendo
 * ocupado: aquele teto existe para conter chamadas ao mesmo tempo, e um recado ali abriria um canal
 * de áudio a mais justamente quando o limite já foi atingido. O recado ocupa vaga no teto enquanto
 * grava — no máximo `inbound.max_concurrent_calls` recados ao mesmo tempo, por construção.
 *
 * O arquivo é o mesmo da gravação de chamada (`recordingPath`): a tela da chamada já toca dele, sem
 * rota nova. O processo não sintetiza fala, então a abertura é um bipe de "fale agora", distinto dos
 * três bipes de falha.
 */
export type VoicemailReason = "no_agent" | "agent_disabled";

/** O que a chamada precisa carregar até o AudioSocket conectar. */
export interface VoicemailJob {
  reason: VoicemailReason;
  maxSeconds: number;
}

/** Silêncio que encerra o recado, contado a partir da última fala. */
export const VOICEMAIL_SILENCE_MS = 4000;
/** Fala mínima para o recado valer: abaixo disto é ruído da linha, e não recado. */
export const VOICEMAIL_MIN_SPEECH_MS = 500;
/** Pico (PCM16, 32767 é o máximo) a partir do qual o quadro conta como fala. */
export const SPEECH_PEAK = 1200;

export interface VoicemailDeps {
  db: Db;
  clock: Clock;
  /** Pasta das gravações; sem ela, o recado não tem onde ficar e a chamada é encerrada. */
  recordingsDir?: string;
  schedule?: Schedule;
  log?: Logger;
}

export interface VoicemailInput {
  organizationId: string;
  callId: string;
  /** Como a chamada seria recusada: só os dois motivos em que a linha não tem quem atenda. */
  reason: VoicemailReason;
  maxSeconds: number;
  transport: CallTransport;
}

export interface VoicemailOutcome {
  status: "completed" | "failed";
  /** O desfecho gravado na chamada: `voicemail` ou `voicemail_failed`. */
  endReason: string;
  /** O que encerrou o recado: `silence`, `max_duration`, `caller_hangup`, `shutdown`. */
  cause: string;
  /** Sobrou recado de verdade (fala acima de `VOICEMAIL_MIN_SPEECH_MS`). */
  left: boolean;
  /** Quanto áudio foi recebido, em segundos. */
  seconds: number;
  /** Arquivo do recado, quando sobrou um. */
  file: string | null;
}

export interface VoicemailSession {
  /** Resolve quando o recado terminou e tudo foi gravado. Nunca rejeita. */
  done: Promise<VoicemailOutcome>;
  /** Encerra de fora (o processo está saindo). */
  stop(reason: string): void;
}

interface Ending {
  /** O que encerrou o recado; vai para o evento, não para o `end_reason` da chamada. */
  cause: string;
  callerGone?: boolean;
  /** O gravador não pôde gravar; a chamada termina como falha, com o motivo. */
  failure?: { reason: string; error: string };
}

/**
 * Um bipe de "fale agora": 400 ms a 700 Hz. Os três bipes de `failureTone` são 160 ms a 480 Hz, e
 * um único bipe grave não se confunde com eles.
 */
export function voicemailPrompt(): Buffer {
  const beepMs = 400;
  const samples = (beepMs * SAMPLE_RATE) / 1000;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    pcm.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 700 * i) / SAMPLE_RATE)), i * 2);
  }
  return pcm;
}

/** O quadro tem fala? Olha o pico do trecho, sem depender de formato além do PCM16. */
export function hasSpeech(pcm16_8k: Buffer): boolean {
  for (let i = 0; i + 1 < pcm16_8k.length; i += 2) {
    if (Math.abs(pcm16_8k.readInt16LE(i)) >= SPEECH_PEAK) return true;
  }
  return false;
}

const ms = (bytes: number): number => (bytes / 2 / SAMPLE_RATE) * 1000;

export function startVoicemailSession(deps: VoicemailDeps, input: VoicemailInput): VoicemailSession {
  const { db, clock } = deps;
  const schedule = deps.schedule ?? realSchedule;
  const log: Logger = (level, message, fields) => (deps.log ?? silentLogger)(level, message, { callId: input.callId, ...fields });
  const { organizationId, callId, transport } = input;
  const dir = deps.recordingsDir;

  let ending = false;
  let recordedBytes = 0;
  let speechBytes = 0;
  let recorder: Recording | undefined;
  let openFailure: { reason: string; error: string } | undefined;
  let cancelSilence: (() => void) | undefined;
  const cancelTimers: Array<() => void> = [];
  const pending: Buffer[] = [];
  let resolveDone: (outcome: VoicemailOutcome) => void = () => undefined;
  const done = new Promise<VoicemailOutcome>((resolve) => (resolveDone = resolve));
  let beginSettled: () => void = () => undefined;
  let openSettled: () => void = () => undefined;
  const begun = new Promise<void>((resolve) => (beginSettled = resolve));
  const opened = new Promise<void>((resolve) => (openSettled = resolve));

  const leftOf = (): boolean => speechBytes >= (VOICEMAIL_MIN_SPEECH_MS / 1000) * SAMPLE_RATE * 2;

  /**
   * O único encerramento: roda uma vez, por qualquer caminho — silêncio, teto de tempo, quem ligou
   * desligando, falha do gravador ou o processo saindo. Fecha o arquivo, grava o desfecho e solta a
   * telefonia mesmo que o banco falhe.
   */
  async function finish(end: Ending): Promise<void> {
    if (ending) return;
    ending = true;
    cancelSilence?.();
    for (const cancel of cancelTimers) cancel();

    // A chamada precisa existir no banco e o arquivo precisa estar aberto (ou ter falhado) antes de
    // fechar: quem liga pode desligar no mesmo instante em que é atendido.
    await begun;
    await opened;

    const left = leftOf();
    let failure = end.failure ?? openFailure;
    let file: string | null = null;
    if (recorder) {
      try {
        const saved = await recorder.finish();
        if (saved && left && dir) file = recordingPath(dir, organizationId, callId);
        // Silêncio ou ruído não vira recado: o arquivo sai, e a linha do tempo diz que não houve fala.
        if (saved && !left && dir) await rm(recordingPath(dir, organizationId, callId), { force: true });
      } catch (error) {
        // A gravação falhou enquanto gravava (disco cheio, escrita recusada): o recado não existe.
        failure ??= { reason: "write_failed", error: messageOf(error) };
      }
    }
    const status = failure ? "failed" : "completed";
    // A chamada fechou pela caixa postal: `end_reason` é `voicemail`, e o que encerrou o recado
    // (silêncio, teto de tempo, quem ligou desligando) fica no evento.
    const endReason = failure ? "voicemail_failed" : "voicemail";
    const seconds = Math.round(ms(recordedBytes)) / 1000;

    try {
      await withOrg(db, organizationId, async (q) => {
        await q.exec("update calls set status = $2, end_reason = $3, ended_at = $4 where id = $1", [callId, status, endReason, clock.now()]);
        if (failure) await recordEvent(q, callId, "voicemail_failed", { reason: failure.reason, error: failure.error, refused_for: input.reason }, clock.now());
        // `recorded` diz se sobrou áudio no disco; `left` diz se sobrou recado (fala) de verdade.
        else await recordEvent(q, callId, "voicemail_left", { left, recorded: file !== null, seconds, file, reason: input.reason, cause: end.cause }, clock.now());
        await recordEvent(q, callId, "call_ended", { status, reason: endReason, costCents: 0, seconds }, clock.now());
      });
    } catch (error) {
      log("error", "could not record the end of the voicemail", { error: messageOf(error) });
    }

    // Ninguém fica pendurado: a telefonia é solta mesmo se o banco falhou acima.
    try {
      if (end.callerGone) await transport.close();
      else await transport.hangup();
    } catch (error) {
      log("error", "could not release the telephony side of the voicemail", { error: messageOf(error) });
    }
    resolveDone({ status, endReason, cause: end.cause, left, seconds, file });
  }

  /** A chegada da chamada no banco: aceita (`in_progress`), com hora de atendimento e evento. */
  async function start(): Promise<void> {
    try {
      await withOrg(db, organizationId, async (q) => {
        const call = await q.one<{ from_e164: string | null; to_e164: string | null }>("select from_e164, to_e164 from calls where id = $1", [callId]);
        await q.exec("update calls set status = 'in_progress', answered_at = $2 where id = $1", [callId, clock.now()]);
        await recordEvent(q, callId, "call_started", { direction: "inbound", from: call?.from_e164 ?? null, to: call?.to_e164 ?? null, voicemail: input.reason }, clock.now());
      });
    } catch (error) {
      log("error", "could not record the start of the voicemail", { error: messageOf(error) });
    } finally {
      beginSettled();
    }
  }

  /** Abre o arquivo do recado. Sem pasta ou sem espaço, a chamada não finge que anotou: encerra. */
  async function open(): Promise<void> {
    try {
      if (!dir) {
        openFailure = { reason: "unavailable", error: "RECORDINGS_DIR is not configured" };
        return;
      }
      // Sem espaço no disco, o recado não cabe: encerra com o motivo em vez de gravar meia frase.
      const free = await freeBytes(dir);
      if (free < MIN_FREE_BYTES_TO_RECORD) {
        openFailure = { reason: "low_disk", error: `${free} bytes free` };
        return;
      }
      recorder = await startRecording(recordingPath(dir, organizationId, callId), () => clock.now().getTime(), {
        onFailure: (reason: RecordingFailureReason, error: Error) => {
          log("error", "the voicemail recording failed; the call ends", { reason, error: error.message });
          void finish({ cause: "record_failed", failure: { reason, error: error.message } });
        },
      });
    } catch (error) {
      openFailure = { reason: "unavailable", error: messageOf(error) };
    } finally {
      openSettled();
    }
    if (openFailure) return void (await finish({ cause: "record_failed", failure: openFailure }));
    if (!recorder) return;
    // O que chegou antes de o arquivo existir entra agora, na ordem em que foi falado.
    for (const frame of pending.splice(0)) recorder.caller(frame);
    // Quem ligou já desligou: não há a quem pedir para falar.
    if (ending) return;
    // O bipe de "fale agora", com o arquivo aberto: o recado de quem ligou começa aqui.
    transport.sendAudio(voicemailPrompt());
    log("info", "voicemail recording started", { reason: input.reason, maxSeconds: input.maxSeconds });
  }

  /**
   * O áudio pode chegar antes de o arquivo abrir: o canal já está no ar. O que chega nessa janela
   * fica em memória e é escrito assim que o gravador existir. O limite é o próprio recado inteiro
   * (16 kB por segundo), então nada do que a pessoa falou se perde — e o teto de duração encerra
   * antes de a memória crescer além disso.
   */
  const pendingLimit = Math.max(50, input.maxSeconds * (1000 / 20));
  const ingest = (pcm: Buffer): void => {
    if (ending) return;
    recordedBytes += pcm.length;
    if (recorder) recorder.caller(pcm);
    else if (pending.length < pendingLimit) pending.push(pcm);
    if (!hasSpeech(pcm)) return;
    speechBytes += pcm.length;
    // Cada fala reinicia a contagem: o recado acaba depois do silêncio, não no meio da frase.
    cancelSilence?.();
    cancelSilence = schedule(() => void finish({ cause: "silence" }), VOICEMAIL_SILENCE_MS);
  };

  // Quem ligou desligando e a fala são escutados desde já, antes de qualquer espera.
  transport.onHangup(() => void finish({ cause: "caller_hangup", callerGone: true }));
  transport.onAudio(ingest);
  // Teto de duração armado antes de qualquer áudio: a chamada nunca fica pendurada.
  cancelTimers.push(schedule(() => void finish({ cause: "max_duration" }), input.maxSeconds * 1000));

  void start();
  void open();

  return { done, stop: (reason) => void finish({ cause: reason }) };
}
