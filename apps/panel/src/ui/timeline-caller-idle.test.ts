import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import { LocaleProvider } from "../i18n/provider";
import ptBR from "../i18n/pt-BR/timeline";
import type { CallEvent } from "./types";
import { Timeline } from "./timeline";

/** A ligação calada como `call-session.ts` a grava: três `caller_idle` e o fim por `caller_silent`. */
const events = [
  { id: "1", kind: "caller_idle", at: "2026-11-21T12:00:10.000Z", payload: { action: "asked", silentMs: 10000 } },
  { id: "2", kind: "caller_idle", at: "2026-11-21T12:00:21.000Z", payload: { action: "asked_again", silentMs: 21500 } },
  { id: "3", kind: "caller_idle", at: "2026-11-21T12:00:31.000Z", payload: { action: "ended", silentMs: 31000 } },
  { id: "4", kind: "call_ended", at: "2026-11-21T12:00:37.000Z", payload: { status: "completed", reason: "caller_silent", costCents: 3, seconds: 37 } },
] as CallEvent[];

const visible = (locale: "pt-BR" | "en" | "es"): string =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(Timeline, { events, live: false, agentName: "Ana" }) }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'");

describe("linha do tempo: quem ligou ficou calado (item 9 da segunda leva Vapi)", () => {
  it("cada ação da guarda e o motivo caller_silent têm frase própria nos três idiomas", () => {
    for (const [locale, dict, secs] of [["pt-BR", ptBR, ["10", "21,5", "31"]], ["en", en, ["10", "21.5", "31"]], ["es", es, ["10", "21,5", "31"]]] as const) {
      const html = visible(locale);
      expect(html).toContain(dict.events.caller_idle.asked.replace("{seconds}", secs[0]));
      expect(html).toContain(dict.events.caller_idle.asked_again.replace("{seconds}", secs[1]));
      expect(html).toContain(dict.events.caller_idle.ended.replace("{seconds}", secs[2]));
      expect(html).toContain(dict.reasons.caller_silent);
      expect(html).not.toContain("caller_silent");
      expect(html).not.toContain(dict.events.unknown);
    }
  });
});
