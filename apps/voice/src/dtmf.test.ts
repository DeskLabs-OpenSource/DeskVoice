import { describe, expect, it } from "vitest";
import { silentLogger } from "./log";
import { createSimulatedTransport } from "./simulated-transport";
import { answerLikeWacalls, LOOPBACK_PEER, type FakeLeg } from "./testing/fake-wacalls";
import { manualTime } from "./testing/helpers";
import type { CallTransport } from "./transport";
import { openWhatsAppTransport } from "./whatsapp-transport";

/**
 * A tecla de quem liga chegou ao processo há tempo (o AudioSocket entrega), mas não atravessava o
 * contrato da conversa. Estes testes guardam a travessia — é o que um menu por teclas precisa.
 */
describe("a tecla de quem liga", () => {
  it("chega a quem registrou o handler", () => {
    const transport = createSimulatedTransport();
    const pressed: string[] = [];
    transport.onDtmf?.((digit) => void pressed.push(digit));

    transport.press("1");
    transport.press("0");
    expect(pressed).toEqual(["1", "0"]);
  });

  it("não chega depois do fim da chamada", () => {
    const transport = createSimulatedTransport();
    const pressed: string[] = [];
    transport.onDtmf?.((digit) => void pressed.push(digit));

    transport.press("2");
    // Desligamento de quem liga, que é síncrono: `hangup()` do agente espera a fala pendente sair.
    transport.callerHangup();
    transport.press("3");
    expect(pressed).toEqual(["2"]);
  });

  it("é opcional: o canal sem teclado não declara, e o tipo aceita", async () => {
    // Prova de compilação: um transporte sem `onDtmf` ainda é um `CallTransport`. Se o método virar
    // obrigatório, este arquivo não compila.
    const withoutKeyboard = {
      onAudio: () => undefined,
      sendAudio: () => undefined,
      clearAudio: () => undefined,
      onHangup: () => undefined,
      hangup: async () => undefined,
      transfer: async () => undefined,
      close: async () => undefined,
    } satisfies CallTransport;
    expect("onDtmf" in withoutKeyboard).toBe(false);

    // E o canal sem teclado de verdade, a ligação pelo WhatsApp, não declara: quem precisa de tecla
    // (a URA) descobre isso pelo tipo, e não por uma tecla que nunca chega.
    let leg: FakeLeg | undefined;
    const time = manualTime();
    const whatsapp = await openWhatsAppTransport(
      {
        async exchange(offer) {
          const answered = await answerLikeWacalls(offer);
          leg = answered.leg;
          return answered.answer;
        },
        async end() {},
      },
      { schedule: time.schedule, now: time.now, log: silentLogger, peerConfig: LOOPBACK_PEER },
    );
    try {
      expect(whatsapp.onDtmf).toBeUndefined();
      expect("onDtmf" in whatsapp).toBe(false);
    } finally {
      await whatsapp.close();
      await leg?.connection.close();
    }
  });
});
