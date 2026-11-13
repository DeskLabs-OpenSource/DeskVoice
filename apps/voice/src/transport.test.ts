import { describe, expect, it } from "vitest";
import { dtmfTones, FRAME_BYTES, SAMPLE_RATE } from "./transport";

/** Potência de uma frequência no trecho (Goertzel): o mesmo cálculo de um detector de DTMF. */
function power(pcm: Buffer, frequency: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / SAMPLE_RATE);
  let previous = 0;
  let beforePrevious = 0;
  for (let i = 0; i < pcm.length / 2; i++) {
    const current = pcm.readInt16LE(i * 2) + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  return previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
}

const ALL = [697, 770, 852, 941, 1209, 1336, 1477, 1633];
const toneOf = (pcm: Buffer, index: number): Buffer => pcm.subarray(index * 3200, index * 3200 + 1600);
const strongest = (pcm: Buffer): number[] =>
  ALL.map((frequency) => [frequency, power(pcm, frequency)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([frequency]) => frequency)
    .sort((a, b) => a - b);

describe("dtmfTones", () => {
  it("cada tecla soa nas duas frequências do teclado, com 100 ms de tom e 100 ms de pausa", () => {
    const pcm = dtmfTones("15#D");
    expect(pcm.length).toBe(4 * 3200);
    expect(pcm.length % FRAME_BYTES).toBe(0);
    expect(strongest(toneOf(pcm, 0))).toEqual([697, 1209]);
    expect(strongest(toneOf(pcm, 1))).toEqual([770, 1336]);
    expect(strongest(toneOf(pcm, 2))).toEqual([941, 1477]);
    expect(strongest(toneOf(pcm, 3))).toEqual([941, 1633]);
    expect(pcm.subarray(1600, 3200).every((byte) => byte === 0)).toBe(true);
  });

  it("recusa o que não é tecla de telefone", () => {
    expect(() => dtmfTones("1x")).toThrow(/not a telephone key/);
  });
});
