import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import { fill } from "../i18n/locales";
import { LocaleProvider } from "../i18n/provider";
import ptBR from "../i18n/pt-BR/timeline";
import type { CallEvent } from "./types";
import { Timeline } from "./timeline";

/** O aviso e o pedido de aprovação de uma chamada simulada, como `notify_human` e `askApproval` os gravam. */
const events = (withheld?: string[]): CallEvent[] =>
  [
    { id: "1", kind: "human_notified", at: "2026-11-27T12:00:00.000Z", payload: { message: "Retornar para Ana", urgency: "normal", channels: ["panel"], ...(withheld && { withheld }) } },
    { id: "2", kind: "approval_requested", at: "2026-11-27T12:00:01.000Z", payload: { approvalId: "a", question: "Posso dar desconto?", context: "Cliente antiga", defaultOnTimeout: "denied", ...(withheld && { withheld }) } },
  ] as CallEvent[];

const visible = (locale: "pt-BR" | "en" | "es", list: CallEvent[]): string =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(Timeline, { events: list, live: false, agentName: "Ana" }) })).replace(/<[^>]+>/g, " ");

describe("linha do tempo: o que a chamada simulada segurou", () => {
  it("o aviso e o pedido de aprovação dizem que o WhatsApp não saiu, nos três idiomas", () => {
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const line = fill(dict.events.withheld, { channels: "WhatsApp" });
      expect(visible(locale, events(["whatsapp"])).split(line)).toHaveLength(3);
    }
  });

  it("sem `withheld` (a ligação de verdade) a linha não aparece", () => {
    expect(visible("pt-BR", events())).not.toContain(fill(ptBR.events.withheld, { channels: "WhatsApp" }));
  });
});
