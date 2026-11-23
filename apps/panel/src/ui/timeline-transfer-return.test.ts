import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import { LocaleProvider } from "../i18n/provider";
import ptBR from "../i18n/pt-BR/timeline";
import type { CallEvent } from "./types";
import { Timeline } from "./timeline";

/** A transferência que ninguém atendeu e a volta para o agente, como `asterisk-transport.ts` as grava. */
const unanswered = { id: "1", kind: "transfer_completed", at: "2026-11-21T12:00:00.000Z", payload: { to: "+5531988887777", status: "NOANSWER", answered: false } } as CallEvent;
const back = { id: "2", kind: "transfer_returned", at: "2026-11-21T12:00:00.100Z", payload: { status: "NOANSWER" } } as CallEvent;

const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

const visible = (locale: "pt-BR" | "en" | "es", events: CallEvent[]): string =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(Timeline, { events, live: false, agentName: "Ana" }) }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

describe("linha do tempo: a transferência não atendida que voltou para o agente", () => {
  it("o fim da transferência vem seguido da volta, com o estado, nos três idiomas", () => {
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale, [unanswered, back]);
      expect(html).toContain(dict.events.transfer_unanswered);
      const returned = fill(dict.events.transfer_returned, { status: "NOANSWER" });
      expect(html).toContain(returned);
      expect(html.indexOf(dict.events.transfer_unanswered)).toBeLessThan(html.indexOf(returned));
      expect(html).not.toContain(dict.events.unknown);
      expect(html).not.toContain("transfer_returned");
    }
  });
});
