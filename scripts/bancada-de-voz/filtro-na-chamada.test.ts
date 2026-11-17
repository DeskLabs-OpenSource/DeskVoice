import { describe, expect, it } from "vitest";
import type { DecideInput, DecideResult, DecisionAnswer } from "../../packages/voice-engine/src/types";
import type { ItemDoFiltro } from "./filtro";
import { piorCaso, rodar, tabela, type Decidir } from "./filtro-na-chamada";

const vocabulario = ["Melgaço", "Betim"];
const itens: ItemDoFiltro[] = [
  { id: "l1", tipo: "leitura", agente: "Cidade?", trecho: "moro em meu gasto", errado: "meu gasto", esperado: "Melgaço" },
  { id: "l2", tipo: "leitura", agente: "Cidade?", trecho: "moro em bet in", errado: "bet in", esperado: "Betim" },
  { id: "l3", tipo: "leitura", agente: "Cidade?", trecho: "moro em belo horizonte", esperado: "nenhum" },
  { id: "f1", tipo: "fundo", agente: "Cidade?", trecho: "em Betim", esperado: "pessoa" },
  { id: "f2", tipo: "fundo", agente: "Cidade?", trecho: "e agora a previsão do tempo", esperado: "fundo" },
  { id: "t1", tipo: "terminou", agente: "Cidade?", trecho: "moro em Betim", esperado: "terminou" },
];

const ok = (answers: Record<string, DecisionAnswer>, latencyMs = 200): DecideResult => ({ ok: true, answers, model: "falso", usage: {}, costCents: 0, costMicrocents: 10, latencyMs });
const choice = (c: string, confidence: number): DecisionAnswer => ({ kind: "choice", choice: c, probabilities: {}, confidence });
const noul = (value: number): DecisionAnswer => ({ kind: "noul", value });

/** Um decisor falso que erra de propósito: deixa de trocar o l2 (certo abaixo do corte), escolhe termo no l3 abaixo do corte, marca a pessoa como fundo. */
const falso: Decidir = async (input: DecideInput) => {
  const trecho = input.state.split("Pessoa: ")[1] ?? "";
  if (trecho === "moro em meu gasto") return ok({ background: noul(1), finished: noul(1), reading: choice("Melgaço", 0.9) });
  if (trecho === "moro em bet in") return ok({ background: noul(1), finished: noul(1), reading: choice("Betim", 0.7999) });
  if (trecho === "moro em belo horizonte") return ok({ background: noul(1), finished: noul(1), reading: choice("Betim", 0.5) });
  if (trecho === "em Betim") return ok({ background: noul(0.1), finished: noul(1), reading: choice("nenhum", 1) });
  if (trecho === "e agora a previsão do tempo") return { ok: false, failure: "late", status: null, model: "falso", usage: {}, costCents: 0, costMicrocents: 0, latencyMs: 1000 };
  return ok({ background: noul(1), finished: noul(0.9), reading: choice("nenhum", 1) });
};

describe("a medida do filtro do produto", () => {
  it("conta a leitura por tipo de item, o fundo como marca, a latência e o que chegou a tempo", async () => {
    const { registros } = await rodar(itens, vocabulario, falso, 3, { microcents: 1e9, gasto: 0 });
    const saida = tabela(registros, vocabulario);
    expect(saida).toContain("| Leitura, itens com termo: sugeriu o termo certo (≥ 0,8) | 1/2 (50 %) |");
    expect(saida).toContain("| Leitura, itens com termo: deixou de trocar (sem sugestão) | 1/2 (50 %) |");
    expect(saida).toContain("| Leitura, itens com termo: deixou de trocar, mas escolheu o certo abaixo do corte | 1/2 (50 %) |");
    expect(saida).toContain("| Leitura, \"nenhuma troca\": escolheu um termo abaixo do corte (sem efeito) | 1/1 (100 %) |");
    expect(saida).toContain("| Fundo: fala de quem liga marcada como fundo (≥ 0,8) | 1/1 (100 %) |");
    expect(saida).toContain("| Chegaram a tempo (resposta em até 1000 ms) | 5/6 (83 %) |");
    expect(saida).toContain("| Falhas | 1× late |");
  });

  it("para antes de passar do teto", async () => {
    const um = piorCaso({ state: "Agente: Cidade?\nPessoa: moro em meu gasto", questions: {} });
    expect(um).toBeGreaterThan(0);
    const { registros, parou } = await rodar(itens, vocabulario, falso, 1, { microcents: 1, gasto: 0 });
    expect(registros).toEqual([]);
    expect(parou).toBe(true);
  });
});
