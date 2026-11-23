import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import { LocaleProvider } from "../i18n/provider";
import ptBR from "../i18n/pt-BR/timeline";
import type { CallEvent } from "./types";
import { Timeline } from "./timeline";

/** Os dois desfechos da entrega do relatório, como `deliver_webhook` os grava. */
const delivered = {
  id: "1",
  kind: "webhook_delivered",
  at: "2026-11-20T12:00:00.000Z",
  payload: { name: "crm", event: "call.report", status: 202, attempt: 1 },
} as CallEvent;
const failed = {
  id: "2",
  kind: "webhook_failed",
  at: "2026-11-20T12:00:01.000Z",
  payload: { name: "crm", event: "call.report", reason: "http", status: 500, attempt: 3, retrying: false },
} as CallEvent;

const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

const visible = (locale: "pt-BR" | "en" | "es", events: CallEvent[]): string =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(Timeline, { events, live: false, agentName: "Ana" }) }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

describe("linha do tempo: o relatório da ligação entregue ou não ao webhook", () => {
  it("a entrega aparece com a frase própria, o nome do webhook e o HTTP, nos três idiomas", () => {
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale, [delivered]);
      expect(html).toContain(fill(dict.events.webhook_delivered, { name: "crm", status: "202" }));
      expect(html).not.toContain(dict.events.unknown);
      expect(html).not.toContain("webhook_delivered");
    }
  });

  it("a falha aparece com a frase própria, o motivo traduzido e a última tentativa, nos três idiomas", () => {
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale, [failed]);
      expect(html).toContain(fill(dict.events.webhook_failed, { name: "crm" }));
      // O dicionário de motivos é um Record<string, string>: sem a frase de `http`, o teste para aqui.
      const http = dict.events.webhook_failed_reasons.http;
      if (http === undefined) throw new Error(`${locale}: falta webhook_failed_reasons.http no dicionário`);
      expect(html).toContain(fill(http, { status: "500" }));
      expect(html).toContain(fill(dict.events.webhook_failed_gave_up, { attempt: "3" }));
      expect(html).not.toContain(dict.events.unknown);
      expect(html).not.toContain("webhook_failed");
    }
  });
});
