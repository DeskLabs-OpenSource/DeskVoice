import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import { LocaleProvider } from "../i18n/provider";
import ptBR from "../i18n/pt-BR/timeline";
import type { CallEvent } from "./types";
import { Timeline } from "./timeline";

/** A recusa pelo teto de gasto do mês de uma chamada pelo navegador, como `web-calls.ts` a grava. */
const refused = {
  id: "1",
  kind: "call_refused",
  at: "2026-11-19T12:00:00.000Z",
  payload: { reason: "spend_cap_reached", channel: "web", userId: "0c000000-0000-4000-8000-0000000000aa", capCents: 100 },
} as CallEvent;

const visible = (locale: "pt-BR" | "en" | "es"): string =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(Timeline, { events: [refused], live: false, agentName: "Ana" }) }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'");

describe("linha do tempo: a chamada pelo navegador recusada pelo teto do mês", () => {
  it("diz que a chamada foi recusada e que a organização chegou ao teto, nos três idiomas, com as frases que já existem", () => {
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale);
      expect(html).toContain(dict.events.call_refused);
      expect(html).toContain(dict.reasons.spend_cap_reached);
      expect(html).not.toContain("spend_cap_reached");
      expect(html).not.toContain(dict.events.unknown);
    }
  });
});
