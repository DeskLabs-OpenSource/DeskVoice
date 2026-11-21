import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import commonEn from "../../src/i18n/en/common";
import commonEs from "../../src/i18n/es/common";
import { LOCALE_COOKIE } from "../../src/i18n/locales";
import calls from "../../src/i18n/pt-BR/calls";
import common from "../../src/i18n/pt-BR/common";
import privacy from "../../src/i18n/pt-BR/privacy";
import settings from "../../src/i18n/pt-BR/settings";
import update from "../../src/i18n/pt-BR/update";
import whatsapp from "../../src/i18n/pt-BR/whatsapp";
import whatsappCalls from "../../src/i18n/pt-BR/whatsapp-calls";
import { signIn } from "./session";

const hubCard = (page: Page, key: string) => page.locator(`[data-card="${key}"]`);
/** O link "← Configurações" de uma subtela: fica no conteúdo, e não no menu. */
const backLink = (page: Page) => page.getByRole("main").getByRole("link", { name: common.nav.settings, exact: true });

/** Um título de bloco dentro da subtela. O título da tela (h1) fica de fora: em WhatsApp, os dois têm o mesmo nome. */
const blockHeading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true }).and(page.locator(":not(h1)"));

/** Vai à subtela pelo cartão da central, como quem usa, e confere que ela chegou com o nome e o caminho de volta. */
async function openSection(page: Page, card: string, path: string, title: string): Promise<void> {
  await page.goto("/settings");
  await hubCard(page, card).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
  await expect(backLink(page)).toBeVisible();
}

test("configurar: os blocos de uma instalação nova aparecem, e o limite de ligações recebidas persiste", async ({ page }) => {
  await signIn(page);
  // Inteligência artificial, a seção de `/settings/ai`: numa instalação nova nenhuma chave foi cadastrada.
  await openSection(page, "engines", "/settings/ai", settings.sections.ai);
  await expect(page.getByRole("heading", { name: settings.enginesTitle, exact: true })).toBeVisible();
  await expect(page.getByText(settings.keyMissing, { exact: true }).first()).toBeVisible();
  // Versão e atualização: o bloco carregou (a versão em execução foi lida), e não ficou no esqueleto.
  await openSection(page, "system", "/settings/system", settings.sections.system);
  await expect(page.getByRole("heading", { name: update.title, exact: true })).toBeVisible();
  await expect(page.getByText(update.running, { exact: true })).toBeVisible();
  // WhatsApp: o serviço é opcional e não vem instalado.
  await openSection(page, "whatsapp", "/settings/whatsapp", settings.sections.whatsapp);
  await expect(blockHeading(page, whatsapp.title)).toBeVisible();
  await expect(page.getByText(whatsapp.serviceAbsent, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: whatsapp.installService, exact: true })).toBeVisible();
  // Ligação pelo WhatsApp: também opcional, também não vem instalada.
  await expect(page.getByRole("heading", { name: whatsappCalls.title, exact: true })).toBeVisible();
  await expect(page.getByText(whatsappCalls.serviceAbsent, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: whatsappCalls.installService, exact: true })).toBeVisible();

  await openSection(page, "rules", "/settings/calls", settings.sections.calls);
  await expect(page.getByRole("heading", { name: settings.inboundLimitTitle, exact: true })).toBeVisible();
  const limit = page.getByLabel(settings.inboundLimit);
  // Espera o valor gravado chegar ao campo antes de trocar: senão a resposta atrasada sobrescreve a digitação.
  await expect(limit).not.toHaveValue("");
  const next = (await limit.inputValue()) === "7" ? "8" : "7";
  await limit.fill(next);
  await page.getByRole("button", { name: settings.saveInboundLimit, exact: true }).click();
  // O "Salvo." ao lado do botão: espera a gravação antes de recarregar.
  await expect(page.getByRole("status").filter({ hasText: common.actions.saved })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(settings.inboundLimit)).toHaveValue(next);
});

test("subtelas de Configurações: sem barra de abas, com o nome no título e \"← Configurações\" de volta à central", async ({ page }) => {
  await signIn(page);
  const sections = [
    { card: "rules", path: "/settings/calls", title: settings.sections.calls, heading: settings.approvalTitle },
    { card: "whatsapp", path: "/settings/whatsapp", title: settings.sections.whatsapp, heading: settings.whatsappTitle },
    { card: "webhooks", path: "/settings/integrations", title: settings.sections.integrations, heading: settings.webhooksTitle },
    { card: "privacy", path: "/settings/privacy", title: settings.sections.privacy, heading: privacy.retentionTitle },
    { card: "system", path: "/settings/system", title: settings.sections.system, heading: update.title },
    { card: "engines", path: "/settings/ai", title: settings.sections.ai, heading: settings.enginesTitle },
  ];
  const mainNav = page.getByRole("navigation", { name: common.shell.mainNav });
  for (const section of sections) {
    await openSection(page, section.card, section.path, section.title);
    await expect(blockHeading(page, section.heading)).toBeVisible();
    // A barra de abas saiu: nenhuma navegação dentro do conteúdo.
    await expect(page.getByRole("main").getByRole("navigation")).toHaveCount(0);
    await expect(mainNav.getByRole("link", { name: common.nav.settings })).toHaveAttribute("aria-current", "page");
    // O caminho de volta leva à central.
    await backLink(page).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(hubCard(page, section.card)).toBeVisible();
  }
});

test("Minha conta: mora no bloco da conta, abre /settings/account e é a única marcada nela", async ({ page }) => {
  await signIn(page);
  await page.goto("/calls");
  const aside = page.locator("aside");
  await aside.getByRole("link", { name: common.shell.myAccount, exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: settings.sections.account, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: settings.passwordTitle, exact: true })).toBeVisible();
  await expect(backLink(page)).toBeVisible();
  await expect(aside.getByRole("link", { name: common.shell.myAccount, exact: true })).toHaveAttribute("aria-current", "page");
  // Na própria conta, Configurações não fica marcada no menu: uma marca só.
  await expect(page.getByRole("navigation", { name: common.shell.mainNav }).getByRole("link", { name: common.nav.settings })).not.toHaveAttribute("aria-current", "page");
  await expect(aside.locator('[aria-current="page"]')).toHaveCount(1);
});

for (const [locale, dictionary] of [["pt-BR", common], ["en", commonEn], ["es", commonEs]] as const) {
  test(`Minha conta no celular, em ${locale}: o bloco da conta, embaixo da tela, leva a /settings/account`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL ?? "http://127.0.0.1:3080" }]);
    await signIn(page);
    await page.goto("/calls");
    // A lateral não aparece no celular: o link é o do bloco da conta no fim da página.
    await expect(page.locator("aside")).toBeHidden();
    const link = page.getByRole("link", { name: dictionary.shell.myAccount, exact: true });
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(page).toHaveURL(/\/settings\/account$/);
  });
}

// O fracasso que o desenho pede para conferir: uma tela de Configurações sem caminho de chegada.
// A lista vem das pastas com `page.tsx`, e não escrita aqui: uma subtela nova sem cartão reprova.
const SETTINGS_DIR = fileURLToPath(new URL("../../src/app/(app)/settings", import.meta.url));
const SUBSCREENS = readdirSync(SETTINGS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(SETTINGS_DIR, entry.name, "page.tsx")))
  .map((entry) => `/settings/${entry.name}`);

test("nenhuma tela de Configurações fica órfã: cada subtela tem um cartão na central, e a conta tem o bloco da conta", async ({ page }) => {
  expect(SUBSCREENS).toHaveLength(11);
  await signIn(page);
  await page.goto("/settings");
  await expect(hubCard(page, "engines")).toBeVisible();
  const cards = await page.locator("[data-card]").evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).pathname));
  const account = await page.locator("aside").getByRole("link", { name: common.shell.myAccount, exact: true }).getAttribute("href");
  // "Sistema" só tem cartão enquanto a lista de quem administra a instalação não é explícita, que é
  // o caso do CI. Explícita, a tela redireciona para a área da instalação e não precisa de cartão.
  const reached = new Set([...cards, account]);
  expect(SUBSCREENS.filter((screen) => !reached.has(screen))).toEqual([]);
});

/** Troca o `data` de uma leitura `GET` da API, mantendo o resto da resposta de verdade. */
async function rewrite<T>(page: Page, path: string, change: (data: T) => T): Promise<void> {
  await page.route(`**/api/v1${path}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as { ok: boolean; data: T };
    await route.fulfill({ response, json: body.ok ? { ...body, data: change(body.data) } : body });
  });
}

type EngineRead = { requiresKey: boolean; keyConfigured: boolean };
const firstSteps = (page: Page) => page.getByRole("region", { name: settings.hub.firstSteps.title });

test("a central em /settings: sem barra de abas, e cada cartão abre a tela que já existe", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: settings.title })).toBeVisible();
  await expect(hubCard(page, "engines")).toBeVisible();
  // A central não tem barra de abas nem o caminho de volta, que é das subtelas.
  await expect(page.getByRole("main").getByRole("navigation")).toHaveCount(0);
  await expect(backLink(page)).toHaveCount(0);
  const cards = [
    { key: "engines", path: "/settings/ai", heading: settings.enginesTitle },
    { key: "brains", path: "/settings/brains" },
    { key: "voice", path: "/settings/voice" },
    { key: "speechFilter", path: "/settings/speech-filter" },
    { key: "analysts", path: "/settings/analysts" },
    { key: "outcome", path: "/settings/ai", heading: settings.outcomeTitle },
    { key: "whatsapp", path: "/settings/whatsapp", heading: whatsapp.title },
    { key: "webhooks", path: "/settings/integrations", heading: settings.webhooksTitle },
    { key: "rules", path: "/settings/calls", heading: settings.inboundLimitTitle },
    { key: "privacy", path: "/settings/privacy", heading: privacy.retentionTitle },
    { key: "system", path: "/settings/system", heading: update.title },
  ];
  for (const card of cards) {
    await page.goto("/settings");
    await hubCard(page, card.key).click();
    await expect(page).toHaveURL(new RegExp(`${card.path}$`));
    if (card.heading) await expect(blockHeading(page, card.heading)).toBeVisible();
  }
});

test("Primeiros passos: numa organização nova os três passos estão pendentes, e com agente, linha e chave o cartão some", async ({ page }) => {
  await signIn(page);
  // A organização nova, pelas três leituras que o cartão faz: sem agente, sem linha, sem chave.
  await rewrite<unknown[]>(page, "/agents", () => []);
  await rewrite<unknown[]>(page, "/trunks", () => []);
  await rewrite<EngineRead[]>(page, "/engines", (engines) => engines.map((engine) => ({ ...engine, keyConfigured: false })));
  await page.goto("/settings");
  const card = firstSteps(page);
  await expect(card).toBeVisible();
  for (const label of Object.values(calls.empty.steps)) await expect(card.getByRole("link").filter({ hasText: label })).toContainText(calls.empty.todo);
  await expect(hubCard(page, "engines")).toContainText(settings.hub.state.missing);

  // Agente, linha e chave: o cartão some, e o de Motores de voz diz pronto, da mesma leitura.
  await page.unrouteAll({ behavior: "wait" });
  await rewrite<unknown[]>(page, "/agents", (agents) => (agents.length > 0 ? agents : [{ id: "e2e" }]));
  await rewrite<unknown[]>(page, "/trunks", (trunks) => (trunks.length > 0 ? trunks : [{ id: "e2e" }]));
  await rewrite<EngineRead[]>(page, "/engines", (engines) => {
    const keyed = engines.findIndex((engine) => engine.requiresKey);
    return engines.map((engine, index) => (index === keyed ? { ...engine, keyConfigured: true } : engine));
  });
  const read = ["/agents", "/trunks", "/engines"].map((path) => page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1${path}`));
  await page.reload();
  await Promise.all(read);
  await expect(hubCard(page, "engines")).toContainText(settings.hub.state.ready);
  await expect(firstSteps(page)).toHaveCount(0);
});

test("o cartão do WhatsApp: com o QR por ler ou desconectado não diz pronto; sem o serviço, desligado", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  // Na instalação do CI o serviço não vem instalado.
  await expect(hubCard(page, "whatsapp")).toContainText(settings.hub.state.off);
  for (const status of ["qr", "disconnected", "connected"] as const) {
    await page.unrouteAll({ behavior: "wait" });
    await rewrite<Record<string, unknown>>(page, "/whatsapp", (data) => ({ ...data, available: true, service: "running", status }));
    await page.reload();
    const card = hubCard(page, "whatsapp");
    if (status === "connected") {
      await expect(card).toContainText(settings.hub.state.ready);
    } else {
      await expect(card).toContainText(settings.hub.state.missing);
      await expect(card).not.toContainText(settings.hub.state.ready);
    }
  }
});

// Item 8.10 da régua: o teste da chave do motor, provado sem chave real. Nenhum pedido sai para um
// provedor: o motor simulado responde que não pede chave, e um motor sem chave salva é recusado
// antes de qualquer rede.
test("testar a chave: o motor simulado não pede chave, e um motor sem chave salva não chega a testar", async ({ page }) => {
  await signIn(page);
  const simulated = await page.request.post("/api/v1/engines/simulated/key-check");
  expect(simulated.status()).toBe(200);
  expect(((await simulated.json()) as { data: { result: string } }).data.result).toBe("not_needed");

  const engines = ((await (await page.request.get("/api/v1/engines")).json()) as { data: Array<{ id: string; requiresKey: boolean; keyConfigured: boolean }> }).data;
  const withoutKey = engines.find((engine) => engine.requiresKey && !engine.keyConfigured);
  test.skip(!withoutKey, "every engine on this installation already has a key");
  const missing = await page.request.post(`/api/v1/engines/${withoutKey?.id}/key-check`);
  expect(missing.status()).toBe(409);
  expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("engine_key_missing");

  // Na tela: sem chave salva não há o que testar, então o botão não aparece.
  await page.goto("/settings/ai");
  await expect(page.getByText(settings.keyMissing, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: settings.keyTest, exact: true })).toHaveCount(0);
});
