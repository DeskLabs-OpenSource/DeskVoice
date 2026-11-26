import { describe, expect, it } from "vitest";
import { TranscriberOpenError, type TranscriptPiece, type Usage } from "../types";
import { createSimulatedTranscriber, setSimulatedTranscriptScript, type SimulatedTranscription } from "./simulated";
import simulated from "./simulated";

/** 20 ms de áudio de quem ligou, PCM16 mono 8 kHz. */
const frame = (): Buffer => Buffer.alloc(320);
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function open(options: Parameters<typeof createSimulatedTranscriber>[0] = {}) {
  let session: SimulatedTranscription | undefined;
  const transcriber = createSimulatedTranscriber({ ...options, onSession: (opened) => (session = opened) });
  const stream = await transcriber.connect({ language: "pt-BR", vocabulary: [] }, "");
  const pieces: TranscriptPiece[] = [];
  const usage: Usage[] = [];
  const errors: string[] = [];
  const closed: string[] = [];
  stream.on("piece", (piece) => pieces.push(piece));
  stream.on("usage", (increment) => usage.push(increment));
  stream.on("error", (error) => errors.push(error.message));
  stream.on("closed", (reason) => closed.push(reason));
  return { transcriber, stream, session, pieces, usage, errors, closed };
}

describe("transcritor simulado", () => {
  it("sem chave, sem custo, e descoberto como peça da pasta", async () => {
    expect(simulated).toMatchObject({ id: "simulated", keyless: true, provider: "none", processingLocation: { kind: "this-server" }, pricing: { centsPerMinute: 0 } });
    expect(await simulated.checkKey?.("")).toEqual({ result: "not_needed" });
  });

  it("devolve o roteiro pelo relógio do áudio: cada trecho sai quando chega o áudio dele, depois de quem mandou", async () => {
    const { stream, session, pieces } = await open({
      script: [
        { afterAudioMs: 40, text: "quero" },
        { afterAudioMs: 80, text: "quero marcar", alternatives: ["quero mar car"] },
        { afterAudioMs: 100, text: "quero marcar consulta", final: true },
        { afterAudioMs: 140, text: "amanhã" },
      ],
    });
    stream.sendAudio(frame());
    stream.sendAudio(frame());
    // O trecho não sai dentro de quem mandou o áudio: um serviço de verdade responde depois.
    expect(pieces).toEqual([]);
    await tick();
    expect(pieces).toEqual([{ text: "quero", final: false, alternatives: [], startMs: 0, endMs: 40 }]);
    for (let i = 0; i < 5; i++) stream.sendAudio(frame());
    await tick();
    expect(pieces.slice(1)).toEqual([
      { text: "quero marcar", final: false, alternatives: ["quero mar car"], startMs: 0, endMs: 80 },
      { text: "quero marcar consulta", final: true, alternatives: [], startMs: 0, endMs: 100 },
      // O trecho seguinte começa onde o final terminou.
      { text: "amanhã", final: false, alternatives: [], startMs: 100, endMs: 140 },
    ]);
    expect(session?.audioBytes).toBe(7 * 320);
  });

  it("ao fechar, entrega o consumo uma vez, com os segundos de áudio recebidos", async () => {
    const { stream, usage, closed } = await open({ script: [] });
    for (let i = 0; i < 50; i++) stream.sendAudio(frame());
    await stream.close();
    await stream.close();
    expect(usage).toEqual([{ seconds: 1 }]);
    expect(closed).toEqual(["client"]);
  });

  it("`fail` derruba o fluxo no meio: erro, consumo e `closed`, e nada mais sai depois", async () => {
    const { stream, pieces, usage, errors, closed } = await open({ script: [{ afterAudioMs: 20, text: "alô" }, { afterAudioMs: 40, fail: "serviço caiu" }, { afterAudioMs: 60, text: "nunca" }] });
    for (let i = 0; i < 3; i++) stream.sendAudio(frame());
    await tick();
    stream.sendAudio(frame());
    await tick();
    expect(pieces.map((piece) => piece.text)).toEqual(["alô"]);
    expect(errors).toEqual(["serviço caiu"]);
    expect(closed).toEqual(["failed"]);
    expect(usage).toEqual([{ seconds: 0.06 }]);
  });

  it("`refuse` recusa abrir com o motivo no vocabulário fechado", async () => {
    const transcriber = createSimulatedTranscriber({ refuse: "rejected" });
    const opening = transcriber.connect({ language: "pt-BR", vocabulary: [] }, "");
    await expect(opening).rejects.toBeInstanceOf(TranscriberOpenError);
    await expect(opening).rejects.toMatchObject({ result: "rejected" });
  });

  it("roteiro fora da forma é recusado pelo zod, e o global vale para as próximas sessões", async () => {
    expect(() => createSimulatedTranscriber({ script: [{ afterAudioMs: -1, text: "x" }] })).toThrow();
    expect(() => createSimulatedTranscriber({ refuse: "accepted" as never })).toThrow();
    expect(() => setSimulatedTranscriptScript([{ afterAudioMs: 0, text: "x", extra: true } as never])).toThrow();
    setSimulatedTranscriptScript([{ afterAudioMs: 20, text: "do global", final: true }]);
    try {
      const { stream, pieces } = await open();
      stream.sendAudio(frame());
      await tick();
      expect(pieces.map((piece) => piece.text)).toEqual(["do global"]);
    } finally {
      setSimulatedTranscriptScript(undefined);
    }
  });
});
