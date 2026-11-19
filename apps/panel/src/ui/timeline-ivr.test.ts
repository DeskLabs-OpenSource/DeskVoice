import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import { LocaleProvider } from "../i18n/provider";
import ptBR from "../i18n/pt-BR/timeline";
import type { CallEvent } from "./types";
import { Timeline } from "./timeline";

/** A linha do tempo de uma chamada atendida pelo menu por teclas (URA, #223). */
const at = "2026-11-18T12:00:00.000Z";
const event = (id: string, kind: string, payload: Record<string, unknown>): CallEvent => ({ id, kind, at, payload }) as CallEvent;

const render = (events: CallEvent[], locale: "pt-BR" | "en" | "es" = "pt-BR"): string =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(Timeline, { events, live: false, agentName: "Ana" }) }));

const visible = (html: string): string => html.replace(/<[^>]+>/g, " ");

describe("linha do tempo do menu por teclas", () => {
  const call = [
    event("1", "ivr_started", { menu_id: "8d1f0f8e-4a43-4d0a-9c0e-0b6b2b9c1a11" }),
    event("2", "ivr_no_choice", { attempt: 1, kind: "invalid" }),
    event("3", "ivr_no_choice", { attempt: 2, kind: "timeout" }),
    event("4", "ivr_option_chosen", { digit: "2", label: "Financeiro", action: "transfer", elapsed_ms: 4200 }),
    event("5", "transfer_started", { to: "+553132221100", reason: "ivr" }),
    event("6", "call_ended", { status: "transferred", reason: "transferred" }),
  ];

  it("diz a opção escolhida, o tempo e as tentativas sem escolha, sem nenhum evento desconhecido", () => {
    const html = render(call);
    expect(html).toContain("Escolheu a opção 2, Financeiro (4 s)");
    expect(html).toContain(ptBR.events.ivr_option_action.transfer);
    expect(html).toContain(ptBR.events.ivr_started);
    expect(html).toContain(ptBR.events.ivr_no_choice.invalid.replace("{attempt}", "1"));
    expect(html).toContain(ptBR.events.ivr_no_choice.timeout.replace("{attempt}", "2"));
    expect(html).not.toContain(ptBR.events.unknown);
  });

  it("o motivo `ivr` da transferência vira frase nos três idiomas, e nunca aparece como código", () => {
    for (const [locale, dictionary] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const text = visible(render(call, locale));
      expect(text).toContain(dictionary.events.transfer_reason_ivr);
      expect(text).not.toMatch(/(^|\s)ivr(\s|$)/);
      expect(text).not.toContain(dictionary.events.unknown);
    }
  });

  it("a falha que deixa aviso no painel aponta para ele; a que não deixa, não", () => {
    for (const reason of ["prompt_unreadable", "no_person_exit"]) {
      const html = render([event("1", "ivr_failed", { reason })]);
      expect(html).toContain(ptBR.events.ivr_failed_reasons[reason as "prompt_unreadable" | "no_person_exit"]);
      expect(html).toContain(ptBR.events.ivr_failed_notice);
    }
    const disabled = render([event("1", "ivr_failed", { reason: "agent_disabled" })]);
    expect(disabled).toContain(ptBR.events.ivr_failed_reasons.agent_disabled);
    expect(disabled).not.toContain(ptBR.events.ivr_failed_notice);
    // O motivo de fim `ivr_failed` não promete um aviso que pode não existir.
    expect(ptBR.reasons.ivr_failed).not.toMatch(/aviso/);
    expect(en.reasons.ivr_failed).not.toMatch(/notice/);
    expect(es.reasons.ivr_failed).not.toMatch(/aviso/);
  });

  it("o erro inesperado tem frase nos três idiomas e não aponta para um aviso no painel", () => {
    for (const [locale, dictionary] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(render([event("1", "ivr_failed", { reason: "unexpected" })], locale)).replaceAll("&#x27;", "'");
      expect(dictionary.events.ivr_failed_reasons.unexpected, locale).toBeTruthy();
      expect(html).toContain(dictionary.events.ivr_failed_reasons.unexpected);
      expect(html).not.toContain(dictionary.events.ivr_failed_unknown);
      expect(html).not.toContain(dictionary.events.ivr_failed_notice);
    }
  });

  it("o fim pelo menu tem frase para cada motivo", () => {
    const html = render([
      event("1", "ivr_ended", { reason: "no_choice", then: "person" }),
      event("2", "ivr_ended", { reason: "no_choice", then: "hangup" }),
      event("3", "ivr_ended", { reason: "option_hangup" }),
      event("4", "ivr_ended", { reason: "caller_hangup" }),
      event("5", "ivr_ended", { reason: "stopped" }),
    ]);
    for (const said of Object.values(ptBR.events.ivr_ended)) expect(html).toContain(said);
  });
});

describe("as falhas da passagem e da transferência (DESA-187)", () => {
  it("`handoff_failed` e `transfer_failed` têm frase nos três idiomas, sem apontar para um aviso", () => {
    for (const [locale, dictionary] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      for (const reason of ["handoff_failed", "transfer_failed"] as const) {
        const html = visible(render([event("1", "ivr_failed", { reason })], locale)).replaceAll("&#x27;", "'");
        expect(dictionary.events.ivr_failed_reasons[reason], `${locale} ${reason}`).toBeTruthy();
        expect(html).toContain(dictionary.events.ivr_failed_reasons[reason]);
        expect(html).not.toContain(dictionary.events.ivr_failed_unknown);
        expect(html).not.toContain(dictionary.events.ivr_failed_notice);
      }
    }
    // A falha do banco não se confunde com o agente desligado.
    expect(ptBR.events.ivr_failed_reasons.handoff_failed).not.toBe(ptBR.events.ivr_failed_reasons.agent_disabled);
    expect(ptBR.events.ivr_failed_reasons.handoff_failed).not.toMatch(/desligado\. /);
  });

  it("os três dicionários têm as mesmas chaves em `ivr_failed_reasons`", () => {
    const keys = (dictionary: typeof ptBR): string[] => Object.keys(dictionary.events.ivr_failed_reasons).sort();
    expect(keys(en)).toEqual(keys(ptBR));
    expect(keys(es)).toEqual(keys(ptBR));
  });
});
