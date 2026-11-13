import { describe, expect, it } from "vitest";
import { createSimulatedTransport } from "./simulated-transport";
import { manualTime } from "./testing/helpers";

// 1 s de fala a 8 kHz, PCM16.
const speech = Buffer.alloc(16_000);

describe("transporte simulado: o contrato de transport.ts", () => {
  it("hangup espera a fala pendente tocar, na cadência de 20 ms por quadro, antes de soltar", async () => {
    const time = manualTime();
    const transport = createSimulatedTransport({ schedule: time.schedule });
    transport.onAudio(() => undefined);
    transport.sendAudio(speech);
    time.advance(400);
    let done = false;
    const hangup = transport.hangup().then(() => (done = true));
    time.advance(580);
    await Promise.resolve();
    expect(done).toBe(false);
    expect(transport.ended).toBe(false);
    time.advance(20);
    await hangup;
    expect(transport.ended).toBe(true);
  });

  it("quem ligou escuta enquanto a fala toca e só depois manda áudio, como quem ouve antes de responder", () => {
    const time = manualTime();
    const transport = createSimulatedTransport({ schedule: time.schedule });
    let heard = 0;
    transport.onAudio(() => (heard += 1));
    time.advance(100);
    expect(heard).toBe(5);
    transport.sendAudio(speech);
    time.advance(1000);
    expect(heard).toBe(5);
    time.advance(100);
    expect(heard).toBe(10);
  });

  it("transfer também espera; clear descarta a fila, e close solta na hora", async () => {
    const time = manualTime();
    const transport = createSimulatedTransport({ schedule: time.schedule });
    transport.onAudio(() => undefined);
    transport.sendAudio(speech);
    const transfer = transport.transfer("+5511999990000");
    time.advance(1000);
    await transfer;
    expect(transport.transferredTo).toBe("+5511999990000");

    const other = createSimulatedTransport({ schedule: time.schedule });
    other.onAudio(() => undefined);
    other.sendAudio(speech);
    other.clearAudio();
    await other.hangup();
    expect(other.ended).toBe(true);

    const third = createSimulatedTransport({ schedule: time.schedule });
    third.sendAudio(speech);
    await third.close();
    expect(third.ended).toBe(true);
  });
});
