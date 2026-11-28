// Teto de custo zero é "sem teto" na sessão de voz, e a tela precisa dizer isso (#610, 3.5): a dica
// do campo sempre, nos três idiomas, e o aviso em destaque quando o valor digitado vai sem teto,
// inclusive o que só vira zero no arredondamento.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../../i18n/en/agents";
import es from "../../../../i18n/es/agents";
import ptBR from "../../../../i18n/pt-BR/agents";
import { costCeilingCents, costCeilingIsNone, CostCeilingHint } from "./cost-ceiling";

const render = (value: string, t: typeof ptBR = ptBR): string => renderToStaticMarkup(createElement(CostCeilingHint, { t, value }));

describe("teto de custo por ligação", () => {
  it("manda os centavos com vírgula ou ponto, e o que arredonda para zero vai como zero", () => {
    expect(costCeilingCents("5.00")).toBe(500);
    expect(costCeilingCents("0,25")).toBe(25);
    expect(costCeilingCents("0,004")).toBe(0);
    expect(costCeilingCents("0.006")).toBe(1);
  });

  it("zero, 0,00 e 0,004 deixam o agente sem teto; 0,01 e 5 não", () => {
    for (const value of ["0", "0,00", "0.004", "0,004"]) expect(costCeilingIsNone(value), value).toBe(true);
    for (const value of ["0,01", "0.006", "5.00"]) expect(costCeilingIsNone(value), value).toBe(false);
  });

  it("a dica diz que zero é sem teto, mesmo com um teto de verdade", () => {
    const html = render("5.00");
    expect(html).toContain("Zero é &quot;sem teto&quot;");
    expect(html).not.toContain(ptBR.costCeilingNone);
  });

  it("com zero ou com um valor que arredonda para zero, o aviso aparece em destaque", () => {
    for (const value of ["0", "0,004"]) {
      const html = render(value);
      expect(html, value).toContain(`<strong class="block font-bold text-ink">${ptBR.costCeilingNone}</strong>`);
    }
  });

  it("a dica e o aviso existem em inglês e em espanhol", () => {
    for (const t of [en, es] as (typeof ptBR)[]) {
      expect(t.costCeilingHint).toMatch(/0[.,]004/);
      expect(render("0", t)).toContain(t.costCeilingNone);
    }
    expect(en.costCeilingHint).toContain('"no ceiling"');
    expect(es.costCeilingHint).toContain('"sin tope"');
  });
});
