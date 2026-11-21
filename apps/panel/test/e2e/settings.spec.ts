import { expect, test, type Page } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import calls from "../../src/i18n/pt-BR/calls";
import common from "../../src/i18n/pt-BR/common";
import privacy from "../../src/i18n/pt-BR/privacy";
import settings from "../../src/i18n/pt-BR/settings";
import update from "../../src/i18n/pt-BR/update";
import whatsapp from "../../src/i18n/pt-BR/whatsapp";
import whatsappCalls from "../../src/i18n/pt-BR/whatsapp-calls";
import { signIn, unique } from "./session";

const sectionLink = (page: Page, name: string) => page.getByRole("navigation", { name: settings.sectionsNav }).getByRole("link", { name, exact: true });

/** Vai à seção pela navegação de Configurações, como quem usa, e confere que ela ficou marcada. */
async function openSection(page: Page, name: string, path: string): Promise<void> {
  await sectionLink(page, name).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(sectionLink(page, name)).toHaveAttribute("aria-current", "page");
}

test("configurar: os blocos de uma instalação nova aparecem, e o limite de ligações recebidas persiste", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/ai");
  await expect(page.getByRole("heading", { level: 1, name: settings.title })).toBeVisible();

  // Inteligência artificial, a seção de `/settings/ai`: numa instalação nova nenhuma chave foi cadastrada.
  await expect(sectionLink(page, settings.sections.ai)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: settings.enginesTitle, exact: true })).toBeVisible();
  await expect(page.getByText(settings.keyMissing, { exact: true }).first()).toBeVisible();
  // Versão e atualização: o bloco carregou (a versão em execução foi lida), e não ficou no esqueleto.
  await openSection(page, settings.sections.system, "/settings/system");
  await expect(page.getByRole("heading", { name: update.title, exact: true })).toBeVisible();
  await expect(page.getByText(update.running, { exact: true })).toBeVisible();
  // WhatsApp: o serviço é opcional e não vem instalado.
  await openSection(page, settings.sections.whatsapp, "/settings/whatsapp");
  await expect(page.getByRole("heading", { name: whatsapp.title, exact: true })).toBeVisible();
  await expect(page.getByText(whatsapp.serviceAbsent, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: whatsapp.installService, exact: true })).toBeVisible();
  // Ligação pelo WhatsApp: também opcional, também não vem instalada.
  await expect(page.getByRole("heading", { name: whatsappCalls.title, exact: true })).toBeVisible();
  await expect(page.getByText(whatsappCalls.serviceAbsent, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: whatsappCalls.installService, exact: true })).toBeVisible();

  await openSection(page, settings.sections.calls, "/settings/calls");
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

test("seções de Configurações: a navegação leva a cada uma, e Configurações segue marcada no menu", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  const sections = [
    { name: settings.sections.calls, path: "/settings/calls", heading: settings.approvalTitle },
    { name: settings.sections.whatsapp, path: "/settings/whatsapp", heading: settings.whatsappTitle },
    { name: settings.sections.integrations, path: "/settings/integrations", heading: settings.webhooksTitle },
    { name: settings.sections.privacy, path: "/settings/privacy", heading: privacy.retentionTitle },
    { name: settings.sections.system, path: "/settings/system", heading: update.title },
    { name: settings.sections.account, path: "/settings/account", heading: settings.passwordTitle },
    { name: settings.sections.ai, path: "/settings/ai", heading: settings.enginesTitle },
  ];
  for (const section of sections) {
    await openSection(page, section.name, section.path);
    await expect(page.getByRole("heading", { name: section.heading, exact: true })).toBeVisible();
    // Uma seção marcada por vez.
    await expect(page.getByRole("navigation", { name: settings.sectionsNav }).locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: common.shell.mainNav }).getByRole("link", { name: common.nav.settings })).toHaveAttribute("aria-current", "page");
  }
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
const hubCard = (page: Page, key: string) => page.locator(`[data-card="${key}"]`);
const firstSteps = (page: Page) => page.getByRole("region", { name: settings.hub.firstSteps.title });

test("a central em /settings: nenhuma aba marcada, e cada cartão abre a tela que já existe", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: settings.title })).toBeVisible();
  await expect(hubCard(page, "engines")).toBeVisible();
  await expect(page.getByRole("navigation", { name: settings.sectionsNav }).locator('[aria-current="page"]')).toHaveCount(0);
  const cards = [
    { key: "engines", path: "/settings/ai", heading: settings.enginesTitle },
    { key: "brains", path: "/settings/brains" },
    { key: "voice", path: "/settings/voice" },
    { key: "speechFilter", path: "/settings/speech-filter" },
    { key: "analysts", path: "/settings/analysts" },
    { key: "outcome", path: "/settings/after-call", heading: settings.outcomeTitle },
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
    if (card.heading) await expect(page.getByRole("heading", { name: card.heading, exact: true })).toBeVisible();
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

// Parte 5 do desenho da central: os opcionais com custo saem de `/settings/ai` para
// `/settings/after-call`, lidos e gravados nas mesmas chaves de antes.
const OPTIONALS = ["calls.outcome_enabled", "calls.analysis_enabled", "calls.transcription_enabled", "calls.auto_transcription_enabled"] as const;
const putSetting = async (page: Page, key: string, value: unknown) => expect((await page.request.put(`/api/v1/settings/${key}`, { data: { value } })).status()).toBe(200);
const readSetting = async (page: Page, key: string): Promise<unknown> => ((await (await page.request.get(`/api/v1/settings/${key}`)).json()) as { data: { value: unknown } }).data.value;

test("depois da ligação: o opcional ligado antes aparece ligado na tela nova, da mesma chave, e a tela de IA fica só com as chaves", async ({ page }) => {
  await signIn(page);
  try {
    // Antes: o que a tela de IA gravava ao ligar cada opcional (`put(chave, true)`), pela mesma rota.
    for (const key of OPTIONALS) await putSetting(page, key, true);

    await page.goto("/settings");
    await hubCard(page, "outcome").click();
    await expect(page).toHaveURL(/\/settings\/after-call$/);
    for (const label of [settings.outcomeSwitch, settings.analysisSwitch, settings.transcriptionSwitch, settings.autoTranscriptionSwitch])
      await expect(page.getByRole("switch", { name: label, exact: true }), label).toHaveAttribute("aria-checked", "true");

    // Desligar na tela nova grava na mesma chave, e a leitura de volta concorda.
    await page.getByRole("switch", { name: settings.outcomeSwitch, exact: true }).click();
    await expect(page.getByRole("switch", { name: settings.outcomeSwitch, exact: true })).toHaveAttribute("aria-checked", "false");
    expect(await readSetting(page, "calls.outcome_enabled")).toBeNull();
    await page.reload();
    await expect(page.getByRole("switch", { name: settings.outcomeSwitch, exact: true })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("switch", { name: settings.analysisSwitch, exact: true })).toHaveAttribute("aria-checked", "true");

    // A tela de IA: as chaves dos motores, e nenhum opcional com custo.
    await page.goto("/settings/ai");
    await expect(page.getByRole("heading", { name: settings.enginesTitle, exact: true })).toBeVisible();
    for (const title of [settings.outcomeTitle, settings.analysisTitle, settings.transcriptionTitle]) await expect(page.getByRole("heading", { name: title, exact: true }), title).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveCount(0);
  } finally {
    for (const key of OPTIONALS) await putSetting(page, key, null);
  }
});

test("o link de cadastrar a chave, na tela do agente sem chave, cai na tela de IA", async ({ page }) => {
  await signIn(page);
  const engines = ((await (await page.request.get("/api/v1/engines")).json()) as { data: Array<{ id: string; requiresKey: boolean; keyConfigured: boolean }> }).data;
  const withoutKey = engines.find((engine) => engine.requiresKey && !engine.keyConfigured);
  test.skip(!withoutKey, "every engine on this installation already has a key");
  const created = await page.request.post("/api/v1/agents", { data: { name: `Chave ${unique()}`, engine: withoutKey?.id } });
  expect(created.status()).toBe(200);
  const agentId = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/agents/${agentId}`);
  await expect(page.getByText(agents.engineNoKey, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: agents.engineKeyLink, exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/ai$/);
  await expect(page.getByRole("heading", { name: settings.enginesTitle, exact: true })).toBeVisible();
});
