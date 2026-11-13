import { describe, expect, it } from "vitest";
import { createPacer } from "./pacer";
import { manualTime } from "./testing/helpers";

const FRAME = 4;
const speech = (frames: number): Buffer => Buffer.alloc(frames * FRAME, 7);
const SILENCE = Buffer.alloc(FRAME);

function harness(options: { silence?: boolean } = {}) {
  const time = manualTime();
  const written: Buffer[] = [];
  let open = true;
  const pacer = createPacer({ schedule: time.schedule, now: time.now, frameBytes: FRAME, write: (frame) => written.push(frame), isOpen: () => open, silence: options.silence ? SILENCE : undefined });
  const kinds = (): string => written.map((frame) => (frame.equals(SILENCE) ? "." : frame.every((byte) => byte === 7) ? "s" : "?")).join("");
  return { time, written, pacer, kinds, close: () => (open = false) };
}

describe("pacer", () => {
  it("solta um pedaço a cada 20 ms e para quando a fala acaba", () => {
    const { time, pacer, kinds } = harness();
    pacer.push(speech(3));
    expect(kinds()).toBe("s");
    time.advance(19);
    expect(kinds()).toBe("s");
    time.advance(1);
    expect(kinds()).toBe("ss");
    time.advance(100);
    expect(kinds()).toBe("sss");
    expect(time.pending()).toBe(0);
  });

  it("drained espera o tick depois do último pedaço, que ainda está tocando do outro lado", async () => {
    const { time, pacer } = harness();
    pacer.push(speech(2));
    let done = false;
    void pacer.drained().then(() => (done = true));
    time.advance(20);
    await Promise.resolve();
    expect(done).toBe(false);
    time.advance(20);
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("depois de um engasgo solta no máximo três pedaços de uma vez, e não acumula atraso", () => {
    const { time, pacer, written } = harness();
    pacer.push(speech(20));
    time.stall(200);
    expect(written).toHaveLength(4);
    time.advance(20);
    expect(written).toHaveLength(5);
  });

  it("com silêncio, o compasso não para: sem fala, sai silêncio a cada 20 ms", () => {
    const { time, pacer, kinds } = harness({ silence: true });
    pacer.start();
    time.advance(5 * 60_000);
    expect(kinds()).toBe(".".repeat(15_001));
    pacer.push(speech(2));
    time.advance(60);
    expect(kinds().slice(-3)).toBe("ss.");
  });

  it("com silêncio, a fala espera o start, e o último pedaço curto é completado com silêncio", () => {
    const { time, pacer, written } = harness({ silence: true });
    pacer.push(Buffer.alloc(FRAME + 2, 7));
    time.advance(1000);
    expect(written).toEqual([]);
    pacer.start();
    time.advance(20);
    expect(written.slice(0, 2)).toEqual([Buffer.alloc(FRAME, 7), Buffer.from([7, 7, 0, 0])]);
  });

  it("clear descarta a fala da fila na hora, e o compasso segue com silêncio", () => {
    const { time, pacer, kinds } = harness({ silence: true });
    pacer.start();
    pacer.push(speech(50));
    time.advance(40);
    pacer.clear();
    time.advance(60);
    expect(kinds()).toBe(".ss...");
  });

  it("para quando o caminho fecha, e solta quem esperava a fala sair", async () => {
    const { time, pacer, written, close } = harness({ silence: true });
    pacer.start();
    pacer.push(speech(50));
    const drained = pacer.drained();
    close();
    time.advance(20);
    await drained;
    const count = written.length;
    time.advance(1000);
    expect(written).toHaveLength(count);
    expect(time.pending()).toBe(0);
  });
});
