import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecorder, removePartialRecordings, startRecording } from "./recording";

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

  it("em blocos: o alinhamento e o corte da interrupção valem também depois do que já foi para o disco", () => {
    let t = 0;
    const blocks: Buffer[] = [];
    const rec = createRecorder(() => t, (stereo) => void blocks.push(stereo));
    for (; t < 10_000; t += 20) {
      rec.caller(frame(100));
      if (t === 2000) rec.agent(frame(200, 3000)); // 3 s de fala chegam de uma vez aos 2 s
      if (t === 3000) rec.clear(); // e quem ligou fala por cima aos 3 s
    }
    expect(blocks.length).toBeGreaterThan(5); // foi saindo durante a chamada, não só no fim
    const bytes = rec.end();
    const data = Buffer.concat(blocks);
    expect(data.length).toBe(bytes);
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      left.push(data.readInt16LE(i));
      right.push(data.readInt16LE(i + 2));
    }
    expect(left).toHaveLength(80_000); // 10 s
    expect(left.every((s) => s === 100)).toBe(true);
    expect(right.slice(0, 16_000).every((s) => s === 0)).toBe(true);
    expect(right.slice(16_000, 24_000).every((s) => s === 200)).toBe(true); // de 2 s a 3 s
    expect(right.slice(24_000).every((s) => s === 0)).toBe(true);
  });

  it("chamada de 30 min: nenhuma cópia do que já foi gravado, blocos de tamanho fixo", () => {
    const concat = vi.spyOn(Buffer, "concat");
    let t = 0;
    let largest = 0;
    let written = 0;
    const rec = createRecorder(
      () => t,
      (stereo) => {
        largest = Math.max(largest, stereo.length);
        written += stereo.length;
      },
    );
    const caller = frame(100);
    const agent = frame(200);
    for (; t < 30 * 60_000; t += 20) {
      rec.caller(caller);
      rec.agent(agent);
    }
    rec.end();
    // Um Buffer.concat do acumulado seria uma cópia por pedaço, cada vez maior.
    expect(concat).not.toHaveBeenCalled();
    // Nenhum bloco passa de 2 s de áudio estéreo (64 kB), seja na 1ª fala ou na 90 000ª: o último
    // leva o trecho que ainda podia mudar. É também o teto do que fica em memória.
    expect(largest).toBeLessThanOrEqual(64_000);
    expect(written).toBe(30 * 60 * 8000 * 4);
  });
});

describe("gravação em disco", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("escreve num .part durante a chamada e, no fim, acerta o cabeçalho e vira .wav", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recording-"));
    const file = path.join(dir, "org", "call.wav");
    let t = 0;
    const recording = await startRecording(file, () => t);
    for (; t < 3000; t += 20) recording.caller(frame(7));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await readdir(path.dirname(file))).toEqual(["call.wav.part"]);
    expect((await readFile(`${file}.part`)).length).toBeGreaterThan(44); // já há áudio no disco

    expect(await recording.finish()).toBe(true);
    expect(await readdir(path.dirname(file))).toEqual(["call.wav"]);
    const wav = await readFile(file);
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(wav.readUInt32LE(40)).toBe(150 * 320 * 2); // 3 s, dois canais
  });

  it("sem áudio nenhum, o .part some e não fica .wav", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recording-"));
    const file = path.join(dir, "org", "call.wav");
    expect(await (await startRecording(file, () => 0)).finish()).toBe(false);
    expect(await readdir(path.dirname(file))).toEqual([]);
  });

  it("o .part de um processo que caiu sai quando a voz sobe de novo; o .wav fica", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recording-"));
    await mkdir(path.join(dir, "org"));
    await writeFile(path.join(dir, "org", "a.wav.part"), "RIFF");
    await writeFile(path.join(dir, "org", "b.wav"), "RIFF");
    expect(await removePartialRecordings(dir)).toBe(1);
    expect(await readdir(path.join(dir, "org"))).toEqual(["b.wav"]);
    expect(await removePartialRecordings(path.join(dir, "nada"))).toBe(0);
  });
});
