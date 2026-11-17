import { describe, expect, it } from "vitest";
import type { SpeechUsage } from "../types";
import simulatedDefault, { createSimulatedSynthesizer, toneFor } from "./simulated";

/** Agendador manual: o teste decide quando o áudio sai. */
function manual() {
  const queue: Array<() => void> = [];
  return { schedule: (task: () => void) => queue.push(task), run: () => queue.splice(0).forEach((task) => task()) };
}

async function open() {
  const clock = manual();
  const speech = await createSimulatedSynthesizer(clock.schedule).speak({ voiceId: "simulated", language: "pt-BR" }, "");
  const seen = { audio: [] as Buffer[], usage: [] as SpeechUsage[], spoken: [] as number[], done: 0 };
  speech.on("audio", (pcm) => seen.audio.push(pcm));
  speech.on("usage", (usage) => seen.usage.push(usage));
  speech.on("spoken", (chars) => seen.spoken.push(chars));
  speech.on("done", () => seen.done++);
  return { speech, seen, clock };
}

describe("voz simulada", () => {
  it("é keyless, sem rede, e se apresenta como peça", async () => {
    expect(simulatedDefault.keyless).toBe(true);
    expect(await simulatedDefault.checkKey("")).toEqual({ result: "not_needed" });
    expect(simulatedDefault.pricing.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await simulatedDefault.listVoices("")).toMatchObject({ ok: true, voices: [{ id: "simulated" }] });
  });

  it("gera um tom curto por caractere, PCM16 mono 8 kHz, 10 ms por caractere", () => {
    expect(toneFor(3)).toHaveLength(3 * 80 * 2);
    expect(toneFor(1).readInt16LE(2)).not.toBe(0);
  });

  it("push com flush gera áudio, spoken acumula, end termina com done depois do áudio", async () => {
    const { speech, seen, clock } = await open();
    speech.push("Oi", { flush: true });
    speech.push("tudo");
    speech.end();
    expect(seen.audio).toHaveLength(0);
    clock.run();
    expect(seen.audio.map((pcm) => pcm.length)).toEqual([2 * 160, 4 * 160]);
    expect(seen.spoken).toEqual([2, 6]);
    expect(seen.done).toBe(1);
    expect(seen.usage).toEqual([
      { characters: 2, costMicrocents: 0, estimated: true },
      { characters: 4, costMicrocents: 0, estimated: true },
    ]);
  });

  it("cancel descarta o áudio que não saiu e não emite done", async () => {
    const { speech, seen, clock } = await open();
    speech.push("Uma frase", { flush: true });
    speech.cancel();
    speech.end();
    clock.run();
    expect(seen.audio).toEqual([]);
    expect(seen.done).toBe(0);
    expect(seen.usage).toEqual([{ characters: 9, costMicrocents: 0, estimated: true }]);
  });
});
