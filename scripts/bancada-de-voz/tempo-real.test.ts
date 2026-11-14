import { describe, expect, it } from "vitest";
import { Orcamento } from "./orcamento";
import { PEDACO_MS, bytesPorPedaco, enviarEmTempoReal, type Relogio } from "./tempo-real";

/** Relógio falso: `esperarAte` avança o tempo na hora, e cada espera fica registrada. */
function relogioFalso(inicio = 1000): Relogio & { esperas: number[] } {
  let agora = inicio;
  const esperas: number[] = [];
  return {
    esperas,
    agora: () => agora,
    esperarAte: async (instante) => {
      esperas.push(instante);
      agora = Math.max(agora, instante);
    },
  };
}

describe("enviarEmTempoReal", () => {
  it("manda pedaços de 20 ms, cada um quando seus 20 ms já passaram, sem acumular atraso", async () => {
    const relogio = relogioFalso();
    const enviados: { tamanho: number; em: number }[] = [];
    // 1 s de áudio a 8 kHz = 50 pedaços de 320 bytes.
    const pcm = Buffer.alloc(8000 * 2);
    const { inicioMs, fimMs, pedacos } = await enviarEmTempoReal(pcm, 8000, (p) => enviados.push({ tamanho: p.length, em: relogio.agora() }), relogio);

    expect(pedacos).toBe(50);
    expect(enviados.every((e) => e.tamanho === 320)).toBe(true);
    expect(enviados.map((e) => e.em - inicioMs)).toEqual(Array.from({ length: 50 }, (_, i) => (i + 1) * PEDACO_MS));
    expect(fimMs - inicioMs).toBe(1000);
  });

  it("não manda o arquivo de uma vez: nenhum pedaço sai antes do seu horário", async () => {
    const relogio = relogioFalso(0);
    const momentos: number[] = [];
    await enviarEmTempoReal(Buffer.alloc(16000 * 2 * 0.1), 16000, () => momentos.push(relogio.agora()), relogio);
    // 100 ms a 16 kHz: 5 pedaços de 640 bytes, em 20, 40, 60, 80 e 100 ms.
    expect(bytesPorPedaco(16000)).toBe(640);
    expect(momentos).toEqual([20, 40, 60, 80, 100]);
    expect(relogio.esperas).toEqual([20, 40, 60, 80, 100]);
  });

  it("um pedaço atrasado não empurra os seguintes: a espera é contra o horário absoluto", async () => {
    let agora = 0;
    const relogio: Relogio = {
      agora: () => agora,
      // O primeiro envio atrasa 15 ms (máquina ocupada); os outros chegam na hora.
      esperarAte: async (instante) => {
        agora = Math.max(agora, instante === 20 ? 35 : instante);
      },
    };
    const momentos: number[] = [];
    await enviarEmTempoReal(Buffer.alloc(320 * 3), 8000, () => momentos.push(agora), relogio);
    expect(momentos).toEqual([35, 40, 60]);
  });

  it("o último pedaço incompleto sai do tamanho que tem", async () => {
    const tamanhos: number[] = [];
    await enviarEmTempoReal(Buffer.alloc(320 + 100), 8000, (p) => tamanhos.push(p.length), relogioFalso());
    expect(tamanhos).toEqual([320, 100]);
  });

  it("para quando pedem", async () => {
    let enviados = 0;
    await enviarEmTempoReal(Buffer.alloc(320 * 10), 8000, () => enviados++, relogioFalso(), () => enviados >= 3);
    expect(enviados).toBe(3);
  });
});

describe("Orcamento", () => {
  it("para antes de passar do teto", () => {
    const orcamento = new Orcamento(0.05);
    expect(orcamento.cabe(0.03)).toBe(true);
    orcamento.somar(0.03);
    expect(orcamento.cabe(0.02)).toBe(true);
    expect(orcamento.cabe(0.021)).toBe(false);
    expect(new Orcamento(0).cabe(0.0001)).toBe(false);
    expect(new Orcamento(0).cabe(0)).toBe(true);
  });
});
