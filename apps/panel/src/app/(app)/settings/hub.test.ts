// A central de Configurações (parte 3 do desenho da central de configuração): o estado de cada
// cartão vem de uma leitura que a tela da área já faz, e nunca diz "pronto" para o que não funciona.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import calls from "../../../i18n/pt-BR/calls";
import settings from "../../../i18n/pt-BR/settings";
import { firstSteps } from "../../../ui/first-steps";
import { SettingsHub, type HubView } from "./hub";
import { enginesState, webhooksState, whatsappState } from "./hub-state";
import type { ServiceData } from "./optional-service";

const t = settings.hub;
const base: HubView = { steps: null, engines: null, whatsapp: null, webhooks: null, system: true };
const render = (view: Partial<HubView>): string => renderToStaticMarkup(createElement(SettingsHub, { view: { ...base, ...view }, t, steps: calls.empty }));
/** O trecho de um cartão: do `data-card` até o fim do link. */
const card = (html: string, key: string): string => {
  const start = html.indexOf(`data-card="${key}"`);
  expect(start, key).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</a>", start));
};
const whatsapp = (service: ServiceData["service"], status: ServiceData["status"], available = true) => whatsappState({ available, service, status });

describe("o estado dos cartões da central", () => {
  it("WhatsApp: pronto só com a sessão conectada", () => {
    expect(whatsapp("running", "connected")).toBe("ready");
    for (const status of ["qr", "disconnected", "starting", "failed"] as const) expect(whatsapp("running", status), status).toBe("missing");
    for (const service of ["preparing", "failed", "removing"] as const) expect(whatsapp(service, "disconnected"), service).toBe("missing");
    expect(whatsapp("absent", "disconnected")).toBe("off");
    expect(whatsappState(undefined)).toBeNull();
  });

  it("WhatsApp: conectado com o serviço fora do ar não é pronto (o status gravado não basta)", () => {
    for (const service of ["preparing", "failed", "removing"] as const) expect(whatsapp(service, "connected"), service).toBe("missing");
    expect(whatsapp("absent", "connected")).toBe("off");
  });

  it("WhatsApp: conectado com o serviço indisponível não é pronto", () => {
    expect(whatsapp("running", "connected", false)).toBe("missing");
    expect(whatsapp("failed", "connected", false)).toBe("missing");
    expect(whatsapp("absent", "disconnected", false)).toBe("off");
  });

  it("com o WhatsApp no QR ou desconectado, o cartão não diz pronto", () => {
    for (const status of ["qr", "disconnected"] as const) {
      const html = card(render({ whatsapp: whatsapp("running", status) }), "whatsapp");
      expect(html, status).not.toContain(`>${t.state.ready}<`);
      expect(html, status).toContain(`>${t.state.missing}<`);
    }
    expect(card(render({ whatsapp: whatsapp("running", "connected") }), "whatsapp")).toContain(`>${t.state.ready}<`);
  });

  it("com o serviço do WhatsApp em falha e o status gravado conectado, o cartão não diz pronto", () => {
    const html = card(render({ whatsapp: whatsapp("failed", "connected") }), "whatsapp");
    expect(html).not.toContain(`>${t.state.ready}<`);
    expect(html).toContain(`>${t.state.missing}<`);
  });

  it("motores: pronto com chave, falta algo sem, nada sem leitura", () => {
    expect(enginesState(true)).toBe("ready");
    expect(enginesState(false)).toBe("missing");
    expect(enginesState(undefined)).toBeNull();
  });

  it("webhooks: nenhum endereço é desligado; com algum, ou sem leitura, sem estado", () => {
    expect(webhooksState(null, true)).toBe("off");
    expect(webhooksState([], true)).toBe("off");
    expect(webhooksState([{ name: "a", url: "https://a" }], true)).toBeNull();
    expect(webhooksState(undefined, false)).toBeNull();
  });

  it("as áreas sem leitura ficam sem estado, e cada cartão abre a tela que já existe", () => {
    const html = render({ engines: "ready", whatsapp: "ready", webhooks: "off" });
    const hrefs: Record<string, string> = {
      engines: "/settings/ai",
      brains: "/settings/brains",
      voice: "/settings/voice",
      speechFilter: "/settings/speech-filter",
      analysts: "/settings/analysts",
      outcome: "/settings/after-call",
      whatsapp: "/settings/whatsapp",
      webhooks: "/settings/integrations",
      rules: "/settings/calls",
      privacy: "/settings/privacy",
      system: "/settings/system",
    };
    for (const [key, href] of Object.entries(hrefs)) {
      const start = html.lastIndexOf("<a", html.indexOf(`data-card="${key}"`));
      expect(html.slice(start, html.indexOf(">", start)), key).toContain(`href="${href}"`);
    }
    for (const key of ["brains", "voice", "speechFilter", "analysts", "outcome", "rules", "privacy", "system"]) {
      for (const state of Object.values(t.state)) expect(card(html, key), key).not.toContain(`>${state}<`);
    }
  });

  it("o cartão Sistema segue a regra da aba, e Primeiros passos some sem passos", () => {
    expect(render({ system: false })).not.toContain('data-card="system"');
    expect(render({})).not.toContain(t.firstSteps.title);
    const html = render({ steps: firstSteps({ agents: [], trunks: [], engines: [] }) });
    expect(html).toContain(t.firstSteps.title);
    for (const label of Object.values(calls.empty.steps)) expect(html).toContain(label);
  });
});
