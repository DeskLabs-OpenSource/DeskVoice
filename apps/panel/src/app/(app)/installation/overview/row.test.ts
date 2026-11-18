// A linha de uma organização na visão geral: "pedem atenção" só com algo a pedir, a cor do Motor é a
// da Saúde e não a do estado da chave, e "Nenhuma linha" olha as três contagens (R8, fatia 6b).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ptBR from "../../../../i18n/pt-BR/installation";
import { OverviewRow, type OverviewRowView } from "./row";

const base: OverviewRowView = {
  id: "org-1",
  name: "Clínica Norte",
  suspendedAt: null,
  calls: { count: 3 },
  cost: { cents: 120, unmeasuredCount: 0, estimatedCount: 0 },
  trunk: { connected: 1, attention: 0, down: 0, check: { status: "ok" } },
  engine: { state: "own_key", check: { status: "ok" } },
  queue: { late: 0, failedLast24h: 0 },
};

const render = (row: OverviewRowView): string => renderToStaticMarkup(createElement(OverviewRow, { row, t: ptBR.overview }));

/** A classe do selo que contém o texto. O `Badge` só expõe o tom pela classe de cor. */
const badgeClassOf = (html: string, text: string): string => {
  const match = new RegExp(`<span class="([^"]*)">${text}</span>`).exec(html);
  expect(match, `selo com "${text}"`).not.toBeNull();
  return match![1]!;
};

describe("a linha da visão geral", () => {
  it("sem linha em atenção, não aparece \"0 pedem atenção\"; com duas, aparece", () => {
    expect(render(base)).not.toContain("pedem atenção");
    const html = render({ ...base, trunk: { connected: 1, attention: 2, down: 0, check: { status: "warn" } } });
    expect(html).toContain("1 conectadas, 0 caídas, 2 pedem atenção");
  });

  it("o selo do Motor tem a cor da Saúde: chave própria com teste inconclusivo sai amarela", () => {
    const html = render({ ...base, engine: { state: "own_key", check: { status: "warn" } } });
    const cls = badgeClassOf(html, "Com chave própria");
    expect(cls).toContain("bg-warn-soft");
    expect(cls).not.toContain("bg-ok-soft");
  });

  it("só uma linha em atenção não é \"Nenhuma linha cadastrada\"", () => {
    const html = render({ ...base, trunk: { connected: 0, attention: 1, down: 0, check: { status: "warn" } } });
    expect(html).not.toContain("Nenhuma linha cadastrada");
    expect(html).toContain("0 conectadas, 0 caídas, 1 pedem atenção");
  });

  it("sem resposta do processo de voz, mostra que ele não respondeu, e não números", () => {
    const html = render({ ...base, trunk: null });
    expect(html).toContain("O processo de voz não respondeu");
    expect(html).not.toContain("conectadas");
  });
});
