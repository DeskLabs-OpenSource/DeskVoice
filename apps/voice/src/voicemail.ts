import { FRAME_BYTES, FRAME_MS, type CallTransport } from "./transport";

/**
 * A sessão de recado da caixa postal: toca o aviso, grava o que a pessoa disser e encerra sozinha.
 *
 * Fica separada da conversa de propósito. A conversa (call-session.ts) precisa de motor de voz,
 * chave, ferramentas e tempo real; o recado não precisa de nada disso — é o que faz a caixa postal
 * funcionar com o agente desligado, sem chave e durante uma queda do provedor.
 *
 * O tempo anda em quadros de 20 ms, não em relógio: o transporte entrega áudio nessa cadência, e
 * contar quadros torna o comportamento determinístico no teste, sem esperar tempo real.
 */

export type VoicemailEnd = "silence" | "max_length" | "hangup" | "stopped";

/** 120 s de recado e 8 s de silêncio: o suficiente para um recado inteiro e curto o bastante para
 *  não prender a linha de quem ligou por engano. */
export const VOICEMAIL_MAX_MS = 120_000;
export const VOICEMAIL_SILENCE_MS = 8_000;
/** Energia mínima para considerar que houve fala. Silêncio de linha não é zero (ruído de fundo). */
export const VOICEMAIL_SILENCE_RMS = 220;

export interface VoicemailOptions {
  readonly transport: CallTransport;
  /** Onde o áudio de quem ligou é gravado. Normalmente `recorder.push` do `recording.ts`. */
  readonly push: (pcm16_8k: Buffer) => void;
  /** Aviso tocado antes de gravar. Sem ele, a pessoa fala sem saber — e isso é problema jurídico. */
  readonly notice?: Buffer;
  readonly maxMs?: number;
  readonly silenceMs?: number;
  readonly silenceRms?: number;
  readonly onEnd: (end: VoicemailEnd, spokenMs: number) => void;
}

export interface Voicemail {
  /** Quanto de áudio de quem ligou foi gravado, em ms. */
  readonly spokenMs: number;
  /** Como terminou; `null` enquanto a sessão está viva. */
  readonly ended: VoicemailEnd | null;
  /** Encerra daqui (o operador desligou a caixa postal, ou a chamada foi transferida). */
  stop(): void;
}

/** RMS de um bloco PCM16: a energia que separa fala de ruído de linha. */
export function rmsOf(pcm16_8k: Buffer): number {
  const samples = Math.floor(pcm16_8k.length / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const sample = pcm16_8k.readInt16LE(i * 2);
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

export function createVoicemail(options: VoicemailOptions): Voicemail {
  const maxMs = options.maxMs ?? VOICEMAIL_MAX_MS;
  const silenceLimit = options.silenceMs ?? VOICEMAIL_SILENCE_MS;
  const threshold = options.silenceRms ?? VOICEMAIL_SILENCE_RMS;

  let spokenMs = 0;
  let silenceMs = 0;
  let heardAnything = false;
  let ended: VoicemailEnd | null = null;

  const end = (reason: VoicemailEnd): void => {
    // Sai uma vez só: o desligamento da telefonia e o teto podem chegar juntos.
    if (ended !== null) return;
    ended = reason;
    options.onEnd(reason, spokenMs);
  };

  options.transport.onAudio((pcm16_8k) => {
    if (ended !== null) return;
    options.push(pcm16_8k);

    const ms = (pcm16_8k.length / FRAME_BYTES) * FRAME_MS;
    spokenMs += ms;

    if (rmsOf(pcm16_8k) > threshold) {
      heardAnything = true;
      silenceMs = 0;
    } else {
      silenceMs += ms;
    }

    // Silêncio só encerra depois de alguém ter falado: linha muda espera, não desliga.
    if (heardAnything && silenceMs >= silenceLimit) return end("silence");
    if (spokenMs >= maxMs) return end("max_length");
  });

  options.transport.onHangup(() => end("hangup"));

  if (options.notice && options.notice.length > 0) options.transport.sendAudio(options.notice);

  return {
    get spokenMs() {
      return spokenMs;
    },
    get ended() {
      return ended;
    },
    stop: () => end("stopped"),
  };
}
