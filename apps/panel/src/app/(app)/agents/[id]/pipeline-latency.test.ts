// A latência medida ao lado da escolha, no bloco Pipeline (fatia 5c): a mediana dos turnos sem ferramenta,
// o aviso acima da meta, os turnos com ferramenta à parte e, sem turno medido, "sem medida ainda", nunca um
// zero. Nos três idiomas.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../../i18n/en/agents";
import es from "../../../../i18n/es/agents";
import type { Locale } from "../../../../i18n/locales";
import { LocaleProvider } from "../../../../i18n/provider";
import ptBR from "../../../../i18n/pt-BR/agents";
import type { PipelineLatency } from "../../../../ui/types";
import { LatencyPart } from "./pipeline-block";

const visible = (locale: Locale, t: typeof ptBR, latency: PipelineLatency | null | undefined): string =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(LatencyPart, { t, locale, latency }) }))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

const BASE = { recentCalls: 20, goalP50Ms: 1200 };
const LOCALES = [
  ["pt-BR", ptBR, "1,4", "1,2", "8,0"],
  ["en", en, "1.4", "1.2", "8.0"],
  ["es", es, "1,4", "1,2", "8,0"],
] as const;

describe("a latência no bloco Pipeline", () => {
  it("sem turno medido (o agente novo, ou sem ligação): 'sem medida ainda', sem número", () => {
    for (const [locale, t] of LOCALES) {
      for (const latency of [null, { ...BASE, withoutTool: null, withTool: null }]) {
        const html = visible(locale, t, latency);
        expect(html).toContain(t.pipelineLatency);
        expect(html).toContain(t.pipelineLatencyNone);
        expect(html).not.toMatch(/\d s/);
      }
    }
  });

  it("a mediana sem ferramenta, o aviso acima da meta, e a com ferramenta à parte", () => {
    const latency: PipelineLatency = { ...BASE, withoutTool: { turns: 3, calls: 2, p50Ms: 1400 }, withTool: { turns: 2, calls: 1, p50Ms: 8000 } };
    for (const [locale, t, value, goal, tool] of LOCALES) {
      const html = visible(locale, t, latency);
      expect(html).toContain(t.pipelineLatencyValue.replace("{value}", value).replace("{turns}", "3").replace("{calls}", "2"));
      expect(html).toContain(t.pipelineLatencySlow.replace("{goal}", goal));
      expect(html).toContain(t.pipelineLatencyTool.replace("{value}", tool).replace("{turns}", "2"));
    }
  });

  it("dentro da meta: sem aviso; só turnos com ferramenta: a sem ferramenta diz que não tem medida, e a outra sai à parte", () => {
    for (const [locale, t] of LOCALES) {
      const fast = visible(locale, t, { ...BASE, withoutTool: { turns: 1, calls: 1, p50Ms: 900 }, withTool: null });
      expect(fast).toContain(t.pipelineLatencyValueOne.replace("{value}", locale === "en" ? "0.9" : "0,9").replace("{turns}", "1"));
      expect(fast).not.toContain(t.pipelineLatencySlow.slice(0, 12));
      const toolOnly = visible(locale, t, { ...BASE, withoutTool: null, withTool: { turns: 1, calls: 1, p50Ms: 3000 } });
      expect(toolOnly).toContain(t.pipelineLatencyNoneWithoutTool);
      expect(toolOnly).not.toContain(t.pipelineLatencyNone);
      expect(toolOnly).toContain(t.pipelineLatencyTool.replace("{value}", locale === "en" ? "3.0" : "3,0").replace("{turns}", "1"));
    }
  });
});
