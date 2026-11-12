import { describe, expect, it } from "vitest";
import { createRecorder } from "./recording";

const frame = (value: number, ms = 20): Buffer => Buffer.alloc((ms * 16_000) / 1000, 0).fill(Buffer.from(Int16Array.of(value).buffer));
const channel = (wav: Buffer, side: 0 | 1): number[] => {
  const out: number[] = [];
  for (let i = 44 + side * 2; i < wav.length; i += 4) out.push(wav.readInt16LE(i));
  return out;
};

describe("gravação da chamada", () => {
  it("WAV estéreo 8 kHz: quem ligou à esquerda, agente à direita, cada um no seu tempo", () => {
    let t = 0;
    const rec = createRecorder(() => t);
    t = 20;
    rec.caller(frame(100)); // 0–20 ms
    rec.agent(frame(200, 40)); // chega em 20 ms, toca de 20 a 60 ms
    t = 60;
    rec.caller(frame(100)); // depois de 20 ms sem áudio: o buraco vira silêncio

    const wav = rec.wav();
    expect(wav?.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav?.readUInt16LE(22)).toBe(2);
    expect(wav?.readUInt32LE(24)).toBe(8000);
    const left = channel(wav!, 0);
    const right = channel(wav!, 1);
    expect(left).toHaveLength(480); // 60 ms
    expect(left.slice(0, 160).every((s) => s === 100)).toBe(true);
    expect(left.slice(160, 320).every((s) => s === 0)).toBe(true);
    expect(left.slice(320).every((s) => s === 100)).toBe(true);
    expect(right.slice(0, 160).every((s) => s === 0)).toBe(true);
    expect(right.slice(160, 480).every((s) => s === 200)).toBe(true);
  });

  it("fala do agente em rajada fica em sequência, e a interrupção corta o que não chegou a tocar", () => {
    let t = 0;
    const rec = createRecorder(() => t);
    rec.agent(frame(1, 100));
    rec.agent(frame(2, 100)); // mesma hora: toca depois da primeira
    t = 150;
    rec.clear(); // quem ligou falou por cima aos 150 ms
    const right = channel(rec.wav()!, 1);
    expect(right).toHaveLength(1200); // 150 ms
    expect(right.slice(0, 800).every((s) => s === 1)).toBe(true);
    expect(right.slice(800).every((s) => s === 2)).toBe(true);
  });

  it("sem áudio nenhum, não há gravação", () => {
    expect(createRecorder(() => 0).wav()).toBeNull();
  });
});
