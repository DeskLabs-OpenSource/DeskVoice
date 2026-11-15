import { readFile, rm } from "node:fs/promises";
import { enqueueTask, recordEvent, recordingPath, withOrg, type Clock, type Db, type VoicemailLanguage } from "@deskvoice/core";
import { messageOf, silentLogger, type Logger } from "./log";
import { panelNotice } from "./panel-notice";
import { MIN_FREE_BYTES_TO_RECORD, freeBytes, startRecording, type Recording, type RecordingFailureReason } from "./recording";
import { SAMPLE_RATE, realSchedule, type CallTransport, type Schedule } from "./transport";

/**
 * Recado gravado quando ninguém pode atender (issue #166, decisão 0018).
 *
 * Só entra onde a chamada seria recusada por falta de quem atenda (`no_agent`) ou por o agente
 * estar desligado (`agent_disabled`), com a caixa postal e a gravação da organização ligadas. Os
 * recados têm teto próprio de simultâneas, separado do das conversas (`inboundLimitReached`).
 *
 * Quem liga ouve primeiro o aviso gravado, no idioma da caixa postal, e um bipe. Nada do que a
 * pessoa disser antes de o aviso terminar de tocar é gravado: o transporte põe o aviso na fila e ele
 * sai em quadros de 20 ms, ao longo dos segundos que dura, e é o `drained` do transporte que diz
 * quando acabou. O tempo máximo do recado conta a partir daí.
 *
 * O arquivo é o mesmo da gravação de chamada (`recordingPath`): a tela da chamada já toca dele, sem
 * rota nova, e o prazo de guarda e o apagamento a pedido o alcançam. O aviso fica no canal do agente,
 * como a fala do agente numa conversa: a gravação é a prova do que quem ligou ouviu.
 */
export type VoicemailReason = "no_agent" | "agent_disabled";

/** O que a chamada precisa carregar até o AudioSocket conectar. */
export interface VoicemailJob {
  reason: VoicemailReason;
  maxSeconds: number;
  language: VoicemailLanguage;
}

/** Silêncio que encerra o recado, contado a partir da última fala. */
export const VOICEMAIL_SILENCE_MS = 4000;
/** Fala mínima para o recado valer: abaixo disto é ruído da linha, e não recado. */
export const VOICEMAIL_MIN_SPEECH_MS = 500;
/** Pico (PCM16, 32767 é o máximo) a partir do qual o quadro conta como fala. */
export const SPEECH_PEAK = 1200;
/**
 * Folga sobre a duração do aviso antes de desistir de esperar que ele termine de tocar. O transporte
 * real sempre resolve (`drained` também resolve quando a conexão cai); isto só garante que a linha
 * nunca fica pendurada se ele não resolver.
 */
const NOTICE_SLACK_MS = 5000;

const NOTICE_DIR = new URL("../assets/voicemail-notice/", import.meta.url);

/**
 * O aviso gravado como PCM16 mono a 8 kHz, a forma em que a linha toca. Os arquivos são gerados por
 * `scripts/aviso-da-caixa-postal/gerar.sh`; um arquivo em outro formato é recusado aqui, e não
 * tocado como ruído.
 */
export async function voicemailNotice(language: VoicemailLanguage): Promise<Buffer> {
  const wav = await readFile(new URL(`${language}.wav`, NOTICE_DIR));
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error(`voicemail notice ${language} is not a WAV file`);
  let format: { pcm: boolean; channels: number; rate: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") format = { pcm: wav.readUInt16LE(body) === 1, channels: wav.readUInt16LE(body + 2), rate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14) };
    if (id === "data") {
      if (!format || !format.pcm || format.channels !== 1 || format.rate !== SAMPLE_RATE || format.bits !== 16) throw new Error(`voicemail notice ${language} is not PCM16 mono at ${SAMPLE_RATE} Hz`);
      return wav.subarray(body, Math.min(wav.length, body + size));
    }
    at = body + size + (size % 2);
  }
  throw new Error(`voicemail notice ${language} has no audio`);
}

export interface VoicemailDeps {
  db: Db;
  clock: Clock;
  /** Pasta das gravações; sem ela, o recado não tem onde ficar e a chamada é encerrada. */
  recordingsDir?: string;
  schedule?: Schedule;
  log?: Logger;
}

/**
 * O recado só atende onde dá para saber que o aviso terminou de tocar: `drained` resolve quando tudo
 * o que `sendAudio` enfileirou saiu para quem ligou, ou quando a telefonia caiu. O transporte do
 * Asterisk tem (`AudioSocketConnection.drained`), e a caixa postal só atende pela linha telefônica.
 */
export type VoicemailTransport = CallTransport & { drained(): Promise<void> };

export interface VoicemailInput extends VoicemailJob {
  organizationId: string;
  callId: string;
  transport: VoicemailTransport;
}

export interface VoicemailOutcome {
  status: "completed" | "failed";
  /** O desfecho gravado na chamada: `voicemail` ou `voicemail_failed`. */
  endReason: string;
  /** O que encerrou o recado: `silence`, `max_duration`, `caller_hangup`, `shutdown`, `record_failed`. */
  cause: string;
  /** Sobrou recado de verdade (fala acima de `VOICEMAIL_MIN_SPEECH_MS`). */
  left: boolean;
  /** Quanto áudio de quem ligou foi gravado depois do aviso, em segundos, silêncio incluído. */
  recordedSeconds: number;
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
  /** O recado não pôde ser gravado; a chamada termina como falha, com o motivo. */
  failure?: { reason: string; error: string };
}

/**
 * Um bipe de "fale agora": 400 ms a 700 Hz, tocado logo depois do aviso. Os três bipes de
 * `failureTone` são 160 ms a 480 Hz, e um único bipe grave não se confunde com eles.
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

/** O aviso no painel: é por ele que o recado chega a alguém sem que procurem em Chamadas. */
function noticeOf(outcome: Pick<VoicemailOutcome, "status" | "left" | "recordedSeconds">, from: string | null, to: string | null): string {
  const caller = from ?? "um número oculto";
  const line = to ?? "a linha";
  if (outcome.status === "failed") return `A caixa postal atendeu uma ligação de ${caller} para ${line}, mas o recado não pôde ser gravado. Confira o espaço em disco do servidor.`;
  if (!outcome.left) return `A caixa postal atendeu uma ligação de ${caller} para ${line}, e quem ligou não deixou recado.`;
  return `Recado novo de ${caller} para ${line}, com ${Math.round(outcome.recordedSeconds)} s. Ouça em Chamadas.`;
}

export function startVoicemailSession(deps: VoicemailDeps, input: VoicemailInput): VoicemailSession {
  const { db, clock } = deps;
  const schedule = deps.schedule ?? realSchedule;
  const log: Logger = (level, message, fields) => (deps.log ?? silentLogger)(level, message, { callId: input.callId, ...fields });
  const { organizationId, callId, transport } = input;
  const dir = deps.recordingsDir;
  const maxMs = input.maxSeconds * 1000;

  let ending = false;
  // Só depois de o aviso terminar de tocar o áudio de quem ligou entra no arquivo.
  let listening = false;
  let recordedBytes = 0;
  let speechBytes = 0;
  let recorder: Recording | undefined;
  let cancelSilence: (() => void) | undefined;
  const cancelTimers: Array<() => void> = [];
  let resolveDone: (outcome: VoicemailOutcome) => void = () => undefined;
  const done = new Promise<VoicemailOutcome>((resolve) => (resolveDone = resolve));
  let beginSettled: () => void = () => undefined;
  let openSettled: () => void = () => undefined;
  const begun = new Promise<void>((resolve) => (beginSettled = resolve));
  const opened = new Promise<void>((resolve) => (openSettled = resolve));
  let from: string | null = null;
  let to: string | null = null;

  const leftOf = (): boolean => speechBytes >= (VOICEMAIL_MIN_SPEECH_MS / 1000) * SAMPLE_RATE * 2;

  /**
   * O único encerramento: roda uma vez, por qualquer caminho — silêncio, teto de tempo, quem ligou
   * desligando, falha do gravador ou o processo saindo. Fecha o arquivo, grava o desfecho, avisa no
   * painel, põe o resumo na fila e solta a telefonia mesmo que o banco falhe.
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
    let failure = end.failure;
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
    const recordedSeconds = Math.round(ms(recordedBytes)) / 1000;
    const outcome: VoicemailOutcome = { status, endReason, cause: end.cause, left: left && !failure, recordedSeconds, file: failure ? null : file };

    try {
      await withOrg(db, organizationId, async (q) => {
        await q.exec("update calls set status = $2, end_reason = $3, ended_at = $4 where id = $1", [callId, status, endReason, clock.now()]);
        if (failure) await recordEvent(q, callId, "voicemail_failed", { reason: failure.reason, error: failure.error, refused_for: input.reason }, clock.now());
        // `recorded` diz se sobrou áudio no disco; `left` diz se sobrou recado (fala) de verdade.
        else await recordEvent(q, callId, "voicemail_left", { left, recorded: file !== null, recordedSeconds, file, reason: input.reason, cause: end.cause }, clock.now());
        await recordEvent(q, callId, "call_ended", { status, reason: endReason, costCents: 0, seconds: recordedSeconds }, clock.now());
        await panelNotice(q, clock, callId, noticeOf(outcome, from, to));
        // O mesmo caminho de toda chamada que termina: resumo, transcrição automática (se ligada, com
        // a chave do agente do número) e o aviso ao responsável saem dele.
        const taskId = await enqueueTask(q, { kind: "summarize_call", payload: {}, callId, runAt: clock.now() });
        await recordEvent(q, callId, "task_queued", { taskId, kind: "summarize_call" }, clock.now());
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
    resolveDone(outcome);
  }

  /** A chegada da chamada no banco: aceita (`in_progress`), com hora de atendimento e evento. */
  async function start(): Promise<void> {
    try {
      await withOrg(db, organizationId, async (q) => {
        const call = await q.one<{ from_e164: string | null; to_e164: string | null }>("select from_e164, to_e164 from calls where id = $1", [callId]);
        from = call?.from_e164 ?? null;
        to = call?.to_e164 ?? null;
        await q.exec("update calls set status = 'in_progress', answered_at = $2 where id = $1", [callId, clock.now()]);
        await recordEvent(q, callId, "call_started", { direction: "inbound", from, to, voicemail: input.reason, language: input.language }, clock.now());
      });
    } catch (error) {
      log("error", "could not record the start of the voicemail", { error: messageOf(error) });
    } finally {
      beginSettled();
    }
  }

  /**
   * Abre o arquivo e prepara o aviso. Sem pasta, sem espaço ou sem o aviso, a chamada não finge que
   * anotou: encerra com o motivo, antes de gravar qualquer coisa.
   */
  async function open(): Promise<{ notice: Buffer } | { failure: { reason: string; error: string } }> {
    try {
      if (!dir) return { failure: { reason: "unavailable", error: "RECORDINGS_DIR is not configured" } };
      const free = await freeBytes(dir);
      if (free < MIN_FREE_BYTES_TO_RECORD) return { failure: { reason: "low_disk", error: `${free} bytes free` } };
      const notice = Buffer.concat([await voicemailNotice(input.language), voicemailPrompt()]);
      recorder = await startRecording(recordingPath(dir, organizationId, callId), () => clock.now().getTime(), {
        onFailure: (reason: RecordingFailureReason, error: Error) => {
          log("error", "the voicemail recording failed; the call ends", { reason, error: error.message });
          void finish({ cause: "record_failed", failure: { reason, error: error.message } });
        },
      });
      return { notice };
    } catch (error) {
      return { failure: { reason: "unavailable", error: messageOf(error) } };
    } finally {
      openSettled();
    }
  }

  async function run(): Promise<void> {
    const prepared = await open();
    if ("failure" in prepared) return finish({ cause: "record_failed", failure: prepared.failure });
    // Quem ligou já desligou enquanto o arquivo abria: não há a quem tocar o aviso.
    if (ending) return;
    // O aviso vai para o canal do agente da gravação, como a fala do agente numa conversa.
    recorder?.agent(prepared.notice);
    transport.sendAudio(prepared.notice);
    // Se o aviso não terminar de sair no tempo dele com folga, a linha não fica pendurada.
    cancelTimers.push(schedule(() => void finish({ cause: "max_duration" }), ms(prepared.notice.length) + NOTICE_SLACK_MS + maxMs));
    await transport.drained();
    if (ending) return;
    listening = true;
    // O tempo máximo do recado conta a partir do fim do aviso.
    cancelTimers.push(schedule(() => void finish({ cause: "max_duration" }), maxMs));
    log("info", "voicemail recording started", { reason: input.reason, maxSeconds: input.maxSeconds, language: input.language });
  }

  const ingest = (pcm: Buffer): void => {
    // Antes do fim do aviso, o que chega de quem ligou não é gravado nem contado.
    if (ending || !listening || !recorder) return;
    recordedBytes += pcm.length;
    recorder.caller(pcm);
    if (!hasSpeech(pcm)) return;
    speechBytes += pcm.length;
    // Cada fala reinicia a contagem: o recado acaba depois do silêncio, não no meio da frase.
    cancelSilence?.();
    cancelSilence = schedule(() => void finish({ cause: "silence" }), VOICEMAIL_SILENCE_MS);
  };

  transport.onHangup(() => void finish({ cause: "caller_hangup", callerGone: true }));
  transport.onAudio(ingest);

  void start();
  void run();

  return { done, stop: (reason) => void finish({ cause: reason }) };
}
