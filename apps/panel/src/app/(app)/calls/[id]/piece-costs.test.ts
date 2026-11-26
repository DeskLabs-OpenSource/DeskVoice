// O custo por peça no detalhe da chamada (fatia 5c): a peça sem linha no extrato e a linha sem custo medido
// aparecem como "não medido", nos três idiomas, e nunca como um valor zero.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import enCosts from "../../../../i18n/en/costs";
import en from "../../../../i18n/en/timeline";
import esCosts from "../../../../i18n/es/costs";
import es from "../../../../i18n/es/timeline";
import { LocaleProvider } from "../../../../i18n/provider";
import ptBRCosts from "../../../../i18n/pt-BR/costs";
import ptBR from "../../../../i18n/pt-BR/timeline";
import type { CallDetail } from "../../../../ui/types";
import { PieceCosts } from "./piece-costs";

const visible = (locale: "pt-BR" | "en" | "es", rows: CallDetail["costByPiece"]): string =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(PieceCosts, { rows }) }))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

const row = (piece: string, extra: Partial<CallDetail["costByPiece"][number]>): CallDetail["costByPiece"][number] => ({
  piece,
  id: null,
  label: null,
  model: null,
  costCents: 0,
  lines: 0,
  unmeasuredCount: 0,
  estimatedCount: 0,
  ...extra,
});

describe("o custo por peça no detalhe da chamada", () => {
  it("cada peça com o nome, o modelo e o valor; a sem linha e a não medida dizem 'não medido', nunca zero", () => {
    const rows = [
      row("transcriber", { id: "simulated", label: "Transcritor simulado (sem chave)", costCents: 2, lines: 1 }),
      row("brain", { id: "openai", label: "OpenAI", model: "gpt-5-nano", costCents: 6, lines: 2, estimatedCount: 1 }),
      row("synthesizer", { id: "elevenlabs", label: "ElevenLabs", costCents: 0, lines: 1, unmeasuredCount: 1 }),
    ];
    const missing = [row("transcriber", { id: "simulated", label: "Transcritor simulado (sem chave)", costCents: 2, lines: 1 }), row("brain", {}), row("synthesizer", {})];
    for (const [locale, dict, costs] of [["pt-BR", ptBR, ptBRCosts], ["en", en, enCosts], ["es", es, esCosts]] as const) {
      const html = visible(locale, rows);
      const names = dict.events.pipeline.pieces;
      expect(html).toContain(dict.facts.byPiece);
      expect(html).toContain(`${names.transcriber} · Transcritor simulado (sem chave)`);
      expect(html).toContain(`${names.brain} · OpenAI (gpt-5-nano)`);
      expect(html).toContain(`${names.synthesizer} · ElevenLabs`);
      expect(html).toContain(costs.includesEstimate);
      // A voz não medida: só a marca, e nenhum valor zero na lista.
      expect(html).toContain(costs.unmeasured);
      expect(html).not.toMatch(/\$\s?0[.,]00|0[.,]00\s?US\$/);

      const none = visible(locale, missing);
      // As duas peças sem linha: "não medido" duas vezes, sem id e sem zero.
      expect(none.split(costs.unmeasured)).toHaveLength(3);
      expect(none).not.toMatch(/\$\s?0[.,]00|0[.,]00\s?US\$/);
    }
  });
});
