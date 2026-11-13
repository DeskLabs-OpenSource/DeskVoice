import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_QUEUED_AUDIO_SECONDS, createRecorder, removePartialRecordings, startRecording, type RecordingFailureReason } from "./recording";

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

/** O `write` de todo arquivo aberto com `fs/promises`: é o que a gravação usa para cada bloco. */
async function fileWrite(dir: string) {
  const probe = await open(path.join(dir, "probe"), "w");
  const prototype = Object.getPrototypeOf(probe) as { write: (...args: unknown[]) => Promise<unknown> };
  await probe.close();
  await rm(path.join(dir, "probe"));
  const original = prototype.write;
  return Object.assign(vi.spyOn(prototype, "write"), { original });
}

/** Quem ligou fala de `from` a `to` ms; a cada segundo de chamada, o disco tem a vez de escrever. */
async function speak(recording: { caller(pcm: Buffer): void }, clock: { t: number }, to: number): Promise<void> {
  for (; clock.t < to; clock.t += 20) {
    recording.caller(frame(7));
    if (clock.t % 1000 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("gravação em disco", () => {
  let dir = "";
  afterEach(async () => {
    vi.restoreAllMocks();
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

  it("a escrita falha no meio: a falha é avisada na hora, uma vez, nada mais é gravado e não sobra arquivo", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recording-"));
    const file = path.join(dir, "org", "call.wav");
    const write = await fileWrite(dir);
    const failures: Array<[RecordingFailureReason, string]> = [];
    let t = 0;
    const recording = await startRecording(file, () => t, { onFailure: (reason, error) => void failures.push([reason, error.message]) });
    for (; t < 3000; t += 20) recording.caller(frame(7));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failures).toEqual([]); // o cabeçalho e o primeiro bloco foram para o disco
    const healthy = write.mock.calls.length;

    // O disco enche aos 3 s.
    write.mockRejectedValue(Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }));
    for (; t < 6000; t += 20) recording.caller(frame(7));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failures).toEqual([["disk_full", "ENOSPC: no space left on device, write"]]); // antes do fim da chamada
    const tried = write.mock.calls.length;
    expect(tried).toBe(healthy + 1);

    for (; t < 60_000; t += 20) recording.caller(frame(7)); // a chamada segue, sem gravar
    await expect(recording.finish()).rejects.toThrow("ENOSPC");
    expect(write.mock.calls.length).toBe(tried); // nem os blocos seguintes, nem o cabeçalho final
    expect(failures).toHaveLength(1);
    expect(await readdir(path.dirname(file))).toEqual([]); // nem .wav, nem .part
  });

  it("outro erro de escrita tem motivo próprio", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recording-"));
    const write = await fileWrite(dir);
    write.mockRejectedValue(Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" }));
    const failures: RecordingFailureReason[] = [];
    const recording = await startRecording(path.join(dir, "org", "call.wav"), () => 0, { onFailure: (reason) => void failures.push(reason) });
    await expect(recording.finish()).rejects.toThrow("EIO");
    expect(failures).toEqual(["write_failed"]);
  });

  it("o disco não dá conta: passado o teto da fila, a gravação para, a fila não cresce mais e não sobra arquivo", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recording-"));
    const file = path.join(dir, "org", "call.wav");
    const write = await fileWrite(dir);
    const failures: Array<[RecordingFailureReason, number]> = [];
    const clock = { t: 0 };
    const recording = await startRecording(file, () => clock.t, { onFailure: (reason) => void failures.push([reason, clock.t]) });
    await new Promise((resolve) => setTimeout(resolve, 10)); // o cabeçalho vai para o disco

    // O disco trava: a próxima escrita só volta quando o teste mandar.
    let release: () => void = () => undefined;
    write.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ bytesWritten: 0 }))));
    await speak(recording, clock, 120_000);
    // Parou quando a fila chegou ao teto: o 1º bloco sai aos 2 s (1 s de folga mais 1 s de bloco),
    // e cada segundo de chamada põe mais 1 s de áudio na fila, sem esperar a chamada acabar.
    expect(failures).toHaveLength(1);
    expect(failures[0]?.[0]).toBe("disk_too_slow");
    const failedAt = failures[0]?.[1] ?? 0;
    expect(failedAt).toBeGreaterThanOrEqual((MAX_QUEUED_AUDIO_SECONDS + 2) * 1000);
    expect(failedAt).toBeLessThanOrEqual((MAX_QUEUED_AUDIO_SECONDS + 3) * 1000);

    // O disco volta: o que estava na fila é descartado, nada mais chega a ele.
    const tried = write.mock.calls.length;
    release();
    await expect(recording.finish()).rejects.toThrow("did not keep up");
    expect(write.mock.calls.length).toBe(tried);
    expect(await readdir(path.dirname(file))).toEqual([]);
  });

  it("disco lento, mas dentro do teto: a gravação sai inteira", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recording-"));
    const file = path.join(dir, "org", "call.wav");
    const write = await fileWrite(dir);
    // Um disco em memória, que responde na hora, menos na escrita que o teste segura.
    const written: Array<{ at: number; data: Buffer }> = [];
    write.mockImplementation(async (data, _offset, _length, at) => {
      written.push({ at: Number(at), data: Buffer.from(data as Buffer) });
      return { bytesWritten: (data as Buffer).length };
    });
    const failures: RecordingFailureReason[] = [];
    const clock = { t: 0 };
    const recording = await startRecording(file, () => clock.t, { onFailure: (reason) => void failures.push(reason) });
    await new Promise((resolve) => setImmediate(resolve));
    let release: () => void = () => undefined;
    write.mockImplementationOnce(async (data, _offset, _length, at) => {
      await new Promise<void>((resolve) => (release = resolve));
      written.push({ at: Number(at), data: Buffer.from(data as Buffer) });
      return { bytesWritten: (data as Buffer).length };
    });
    // O 1º bloco sai aos 2 s e a escrita dele fica presa até os 11 s: 9 s de áudio na fila quando
    // o disco volta, abaixo do teto.
    await speak(recording, clock, (MAX_QUEUED_AUDIO_SECONDS + 1) * 1000);
    release();
    await speak(recording, clock, 30_000);
    expect(await recording.finish()).toBe(true);
    expect(failures).toEqual([]);
    const audio = written.filter((block) => block.at >= 44).reduce((sum, block) => sum + block.data.length, 0);
    expect(audio).toBe(30 * 8000 * 4);
    expect(written.at(-1)?.at).toBe(0); // o cabeçalho final, com o tamanho certo
    expect(written.at(-1)?.data.readUInt32LE(40)).toBe(30 * 8000 * 4);
    expect(await readdir(path.dirname(file))).toEqual(["call.wav"]);
  });
});
