// As abas da tela do agente (desenho 2026-11-26, fatia 1): o endereço, as teclas, a aba do campo
// escondido e a linha de mudança não salva.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../../i18n/en/agents";
import es from "../../../../i18n/es/agents";
import ptBR from "../../../../i18n/pt-BR/agents";
import { TabPanel, Tabs, tabKeyTarget } from "../../../../ui/kit";
import { AGENT_TABS, agentTabs, changedTabs, DRAFT_TAB, FORM_TABS, hiddenTabOf, parseAgentTab } from "./agent-tabs";

describe("o endereço da aba (?aba=)", () => {
  it("sem aba, com valor desconhecido ou vazio, abre Agente", () => {
    expect(parseAgentTab(null, false)).toBe("agente");
    expect(parseAgentTab(undefined, false)).toBe("agente");
    expect(parseAgentTab("", false)).toBe("agente");
    expect(parseAgentTab("pipeline", false)).toBe("agente");
    expect(parseAgentTab("Depois", false)).toBe("agente");
  });

  it("cada aba abre pelo nome dela", () => {
    for (const tab of AGENT_TABS) expect(parseAgentTab(tab, false)).toBe(tab);
  });

  it("o agente novo não tem Testes: ?aba=testes abre Agente", () => {
    expect(agentTabs(true)).toEqual(["agente", "ferramentas", "depois", "avancado"]);
    expect(parseAgentTab("testes", true)).toBe("agente");
    expect(parseAgentTab("avancado", true)).toBe("avancado");
  });

  it("a fatia 1 não tem a aba Ligações, e o rodapé fica só nas quatro do formulário", () => {
    expect(AGENT_TABS).toEqual(["agente", "ferramentas", "depois", "testes", "avancado"]);
    expect(FORM_TABS).toEqual(["agente", "ferramentas", "depois", "avancado"]);
  });
});

describe("as teclas das abas (ARIA, ativação automática)", () => {
  it("as setas dão a volta, Home e End vão às pontas", () => {
    expect(tabKeyTarget("ArrowRight", 0, 5)).toBe(1);
    expect(tabKeyTarget("ArrowRight", 4, 5)).toBe(0);
    expect(tabKeyTarget("ArrowLeft", 0, 5)).toBe(4);
    expect(tabKeyTarget("ArrowLeft", 3, 5)).toBe(2);
    expect(tabKeyTarget("Home", 3, 5)).toBe(0);
    expect(tabKeyTarget("End", 1, 5)).toBe(4);
  });

  it("outra tecla não troca de aba", () => {
    expect(tabKeyTarget("Enter", 1, 5)).toBeNull();
    expect(tabKeyTarget("ArrowDown", 1, 5)).toBeNull();
    expect(tabKeyTarget("Tab", 1, 5)).toBeNull();
    expect(tabKeyTarget("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("a lista e o painel das abas", () => {
  const items = [
    { id: "agente", label: "Agente" },
    { id: "avancado", label: "Avançado" },
  ];
  const html = renderToStaticMarkup(createElement(Tabs, { label: "Configuração de Recepção", base: "agent", items, active: "avancado", onSelect: () => undefined }));

  it("tablist com nome; só a aba ativa entra no Tab", () => {
    expect(html).toContain('role="tablist" aria-label="Configuração de Recepção"');
    expect(html).toContain('role="tab" id="agent-tab-agente" aria-selected="false" aria-controls="agent-panel-agente" tabindex="-1"');
    expect(html).toContain('role="tab" id="agent-tab-avancado" aria-selected="true" aria-controls="agent-panel-avancado" tabindex="0"');
  });

  it("a aba ativa é marcada pelo traço da cor do texto, nunca pelo cobre", () => {
    expect(html).toContain("aria-selected:border-ink");
    expect(html).not.toMatch(/accent/);
  });

  it("o painel fechado continua montado, escondido e sem a grade que o mostraria", () => {
    const closed = renderToStaticMarkup(createElement(TabPanel, { base: "agent", id: "depois", active: false, children: createElement("input", { name: "x" }) }));
    expect(closed).toContain('role="tabpanel" id="agent-panel-depois" aria-labelledby="agent-tab-depois" data-tab="depois" tabindex="0" hidden=""');
    expect(closed).toContain('name="x"');
    expect(closed).not.toContain("grid");
    const open = renderToStaticMarkup(createElement(TabPanel, { base: "agent", id: "depois", active: true, children: "x" }));
    expect(open).not.toContain("hidden");
    expect(open).toContain('class="grid gap-6"');
  });
});

describe("a aba do campo inválido", () => {
  const fieldIn = (panel: { hidden: boolean; dataset: { tab?: string } } | null): Element => ({ closest: () => panel }) as unknown as Element;

  it("campo em aba fechada devolve a aba dele", () => {
    expect(hiddenTabOf(fieldIn({ hidden: true, dataset: { tab: "avancado" } }))).toBe("avancado");
    expect(hiddenTabOf(fieldIn({ hidden: true, dataset: { tab: "agente" } }))).toBe("agente");
  });

  it("campo à vista, fora de aba ou em aba desconhecida não troca nada", () => {
    expect(hiddenTabOf(fieldIn({ hidden: false, dataset: { tab: "avancado" } }))).toBeNull();
    expect(hiddenTabOf(fieldIn(null))).toBeNull();
    expect(hiddenTabOf(null)).toBeNull();
    expect(hiddenTabOf(fieldIn({ hidden: true, dataset: { tab: "ligacoes" } }))).toBeNull();
  });
});

describe("onde está a mudança não salva", () => {
  const saved = { name: "Recepção", maxMinutes: "10", tools: ["create_task"], dropFollowUp: "off" };
  const tabOf = { name: "agente", maxMinutes: "avancado", tools: "ferramentas", dropFollowUp: "depois" } as const;

  it("nada mudou, nenhuma aba", () => {
    expect(changedTabs({ ...saved, tools: ["create_task"] }, saved, tabOf)).toEqual([]);
  });

  it("as abas com mudança saem na ordem das abas", () => {
    expect(changedTabs({ ...saved, maxMinutes: "12", name: "Outra" }, saved, tabOf)).toEqual(["agente", "avancado"]);
    expect(changedTabs({ ...saved, tools: [] }, saved, tabOf)).toEqual(["ferramentas"]);
    expect(changedTabs({ ...saved, dropFollowUp: "task" }, saved, tabOf)).toEqual(["depois"]);
  });

  it("a tabela 4.1: idioma na Identidade, limites em Avançado, pendências em Depois", () => {
    expect(DRAFT_TAB.language).toBe("agente");
    expect(DRAFT_TAB.vocabulary).toBe("agente");
    expect(DRAFT_TAB.costCeiling).toBe("avancado");
    expect(DRAFT_TAB.callerIdleGuard).toBe("avancado");
    expect(DRAFT_TAB.handoffTargets).toBe("ferramentas");
    expect(DRAFT_TAB.analystId).toBe("ferramentas");
    expect(DRAFT_TAB.followUpOwner).toBe("depois");
  });
});

describe("os nomes das abas nos três idiomas", () => {
  it("toda aba tem nome em pt-BR, en e es", () => {
    for (const dict of [ptBR, en, es]) for (const tab of AGENT_TABS) expect(dict.tabs[tab].length).toBeGreaterThan(0);
    expect(en.tabs.depois).toBe("After the call");
    expect(es.tabs.avancado).toBe("Avanzado");
  });
});
