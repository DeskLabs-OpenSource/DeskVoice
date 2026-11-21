// A frase do formulário de nova organização (R8, fatia 7d): com o que ela nasce, antes de criar.
import { describe, expect, it } from "vitest";
import en from "../../../i18n/en/installation";
import es from "../../../i18n/es/installation";
import ptBR from "../../../i18n/pt-BR/installation";
import { bornWithText } from "./born-with";

const money = (cents: number): string => `US$ ${(cents / 100).toFixed(2)}`;

describe("a frase de com o que a organização nova nasce", () => {
  it("sem padrão gravado diz sem limite e saída travada", () => {
    const factory = { maxTrunks: null, maxAgents: null, monthlySpendCapCents: null, outboundAllowed: false };
    expect(bornWithText(factory, ptBR.organizations, money)).toBe("Ela nasce com: linhas telefônicas sem limite, agentes sem limite, sem teto de gasto, saída travada.");
    expect(bornWithText(factory, en.organizations, money)).toBe("It starts with: no limit on phone lines, no limit on agents, no spending cap, outbound locked.");
    expect(bornWithText(factory, es.organizations, money)).toBe("Nace con: líneas telefónicas sin límite, agentes sin límite, sin tope de gasto, salida bloqueada.");
  });

  it("com padrão gravado diz os quatro valores; teto 0 é teto, não ausência", () => {
    expect(bornWithText({ maxTrunks: 2, maxAgents: 0, monthlySpendCapCents: 0, outboundAllowed: true }, ptBR.organizations, money)).toBe(
      "Ela nasce com: até 2 linhas telefônicas, até 0 agentes, teto de US$ 0.00 por mês, saída a critério dela.",
    );
  });
});
