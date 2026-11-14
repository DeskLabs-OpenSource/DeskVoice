import { describe, expect, it } from "vitest";
import { FRAME_BYTES, type CallTransport } from "./transport";
import { createVoicemail, rmsOf, VOICEMAIL_SILENCE_MS, type VoicemailEnd } from "./voicemail";

/** Linha falsa: entrega áudio de quem ligou na mão e guarda o que o agente mandou tocar. */
function line() {
  let audio: ((pcm: Buffer) => void) | undefined;
  let hungUp: (() => void) | undefined;
  const played: Buffer[] = [];
  const transport: CallTransport = {
    onAudio: (handler) => void (audio = handler),
    onHangup: (handler) => void (hungUp = handler),
    sendAudio: (pcm) => void played.push(pcm),
    clearAudio: () => {},
    hangup: async () => {},
    transfer: async () => {},
    close: async () => {},
  };
  return {
    transport,
    played,
    speak: (frames: number) => {
      for (let i = 0; i < frames; i++) audio?.(tone());
    },
    quiet: (frames: number) => {
      for (let i = 0; i < frames; i++) audio?.(Buffer.alloc(FRAME_BYTES));
    },
    hangUp: () => hungUp?.(),
  };
}

/** Um quadro de fala: senoide de 400 Hz bem acima do limiar. */
function tone(): Buffer {
  const pcm = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES / 2; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 400 * i) / 8000)), i * 2);
  return pcm;
}

const framesFor = (ms: number): number => Math.ceil(ms / 20);

function session(options: { notice?: Buffer; maxMs?: number; silenceMs?: number } = {}) {
  const fake = line();
  const written: Buffer[] = [];
  const endings: Array<{ end: VoicemailEnd; spokenMs: number }> = [];
  const voicemail = createVoicemail({
    transport: fake.transport,
    push: (pcm) => void written.push(pcm),
    notice: options.notice,
    maxMs: options.maxMs,
    silenceMs: options.silenceMs,
    onEnd: (end, spokenMs) => void endings.push({ end, spokenMs }),
  });
  return { fake, voicemail, written, endings };
}

describe("a sessão de recado", () => {
  it("toca o aviso antes de gravar, e só grava o que vem de quem ligou", () => {
    const notice = tone();
    const { fake, written } = session({ notice });
    expect(fake.played).toEqual([notice]);
    expect(written).toHaveLength(0);

    fake.speak(3);
    expect(written).toHaveLength(3);
  });

  it("linha muda espera: silêncio antes de qualquer fala não encerra", () => {
    const { fake, endings, voicemail } = session({ silenceMs: 1000 });
    fake.quiet(framesFor(30_000));
    expect(endings).toHaveLength(0);
    expect(voicemail.ended).toBeNull();
  });

  it("encerra por silêncio depois que a pessoa falou, e diz quanto foi gravado", () => {
    const { fake, endings } = session({ silenceMs: VOICEMAIL_SILENCE_MS });
    fake.speak(framesFor(6000));
    expect(endings).toHaveLength(0);
    fake.quiet(framesFor(VOICEMAIL_SILENCE_MS));
    expect(endings).toHaveLength(1);
    expect(endings[0]?.end).toBe("silence");
    expect(endings[0]?.spokenMs).toBeGreaterThanOrEqual(6000);
  });

  it("encerra no teto de tempo mesmo com a pessoa falando sem parar", () => {
    const { fake, endings, voicemail } = session({ maxMs: 4000 });
    fake.speak(framesFor(5000));
    expect(endings).toEqual([{ end: "max_length", spokenMs: 4000 }]);
    expect(voicemail.ended).toBe("max_length");
  });

  it("quem ligou desligar encerra, e a gravação já tem o que foi dito", () => {
    const { fake, endings, written } = session();
    fake.speak(5);
    fake.hangUp();
    expect(endings).toHaveLength(1);
    expect(endings[0]?.end).toBe("hangup");
    expect(written).toHaveLength(5);
  });

  it("encerra uma vez só, mesmo com desligamento e teto juntos", () => {
    const { fake, endings } = session({ maxMs: 1000 });
    fake.speak(framesFor(1000));
    fake.hangUp();
    expect(endings).toHaveLength(1);

    // Áudio depois do fim não é gravado nem contado.
    const { voicemail } = session();
    voicemail.stop();
    expect(voicemail.ended).toBe("stopped");
  });

  it("rms distingue fala de silêncio de linha", () => {
    expect(rmsOf(Buffer.alloc(FRAME_BYTES))).toBe(0);
    expect(rmsOf(tone())).toBeGreaterThan(220);
  });
});
