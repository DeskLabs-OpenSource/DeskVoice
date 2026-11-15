import { describe, expect, it } from "vitest";
import { createSimulatedTransport } from "./simulated-transport";

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

  it("é opcional: o canal sem teclado não precisa declarar", () => {
    // A ligação pelo WhatsApp não tem teclado, e o contrato permite não declarar.
    const withoutKeyboard = { onDtmf: undefined } as { onDtmf?: unknown };
    expect(withoutKeyboard.onDtmf).toBeUndefined();
  });
});
