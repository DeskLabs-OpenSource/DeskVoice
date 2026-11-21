import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import commonEn from "../../src/i18n/en/common";
import commonEs from "../../src/i18n/es/common";
import { LOCALE_COOKIE } from "../../src/i18n/locales";
import calls from "../../src/i18n/pt-BR/calls";
import common from "../../src/i18n/pt-BR/common";
import line from "../../src/i18n/pt-BR/line";
import privacy from "../../src/i18n/pt-BR/privacy";
import settings from "../../src/i18n/pt-BR/settings";
import update from "../../src/i18n/pt-BR/update";
import whatsapp from "../../src/i18n/pt-BR/whatsapp";
import whatsappCalls from "../../src/i18n/pt-BR/whatsapp-calls";
import { signIn, unique } from "./session";

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
  // Versão e atualização: o endereço antigo leva o dono à área da instalação (parte 8), e o bloco
  // carregou (a versão em execução foi lida), e não ficou no esqueleto.
  await page.goto("/settings/system");
  await expect(page).toHaveURL(/\/installation\/update$/);
  await expect(page.getByRole("heading", { name: update.title, exact: true })).toBeVisible();
  await expect(page.getByText(update.running, { exact: true })).toBeVisible();
  // WhatsApp: o serviço é opcional e não vem instalado.
  await openSection(page, "whatsapp", "/settings/whatsapp", settings.sections.whatsapp);
  await expect(blockHeading(page, whatsapp.title)).toBeVisible();
  await expect(page.getByText(whatsapp.serviceAbsent, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: whatsapp.installService, exact: true })).toBeVisible();
  // Ligação pelo WhatsApp: também opcional, também não vem instalada. Mora em Linha telefônica.
  await page.goto("/line");
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

/** Entra como um operador novo, pelo aceite do convite, que já abre a sessão dele. */
async function signInAsOperator(page: Page): Promise<void> {
  const id = unique();
  const email = `operador-${id}@example.test`;
  const password = `senha de teste ${id}`;
  await signIn(page);
  const created = await page.request.post("/api/v1/team/invites", { data: { email, name: `Operador ${id}`, role: "operator" } });
  expect(created.status(), "the owner could not invite an operator").toBe(200);
  const token = ((await created.json()) as { data: { link: string } }).data.link.split("/invite/")[1] ?? "";
  await page.context().clearCookies();
  const accepted = await page.request.post(`/api/v1/invites/${token}/accept`, { data: { name: `Operador ${id}`, password } });
  expect(accepted.status(), "the operator could not accept the invite").toBe(200);
}

const RECORDING_NOTICE = "/api/v1/settings/recording_notice.text";

test("a ligação pelo WhatsApp mora em Linha telefônica, e Configurações › WhatsApp aponta para lá por uma versão", async ({ page }) => {
  await signIn(page);
  // B1: o bloco está na Linha, e numa tela só.
  await page.goto("/line");
  await expect(page.locator("#ligacao-pelo-whatsapp").getByRole("heading", { name: whatsappCalls.title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: whatsappCalls.installService, exact: true })).toBeVisible();

  // B2: em WhatsApp, o bloco saiu e o "mudou para…" leva até ele.
  await openSection(page, "whatsapp", "/settings/whatsapp", settings.sections.whatsapp);
  await expect(blockHeading(page, whatsapp.title)).toBeVisible();
  await expect(page.getByRole("heading", { name: whatsappCalls.title, exact: true })).toHaveCount(0);
  const moved = page.getByRole("status").filter({ hasText: settings.movedWhatsAppCalls });
  await expect(moved).toBeVisible();
  await moved.getByRole("link", { name: settings.movedLink, exact: true }).click();
  await expect(page).toHaveURL(/\/line#ligacao-pelo-whatsapp$/);
  await expect(page.locator("#ligacao-pelo-whatsapp").getByRole("heading", { name: whatsappCalls.title, exact: true })).toBeInViewport();
});

const fakeId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FAKE_TRUNKS = [1, 2, 3].map((n) => ({
  id: fakeId(n),
  name: `Linha simulada ${n}`,
  host: `192.0.2.${n}`,
  username: `ramal${n}`,
  authMode: "register",
  callerId: null,
  matchExtra: [],
  outboundHost: null,
  inboundAllowed: [],
  inboundResolvedAt: null,
  inboundFilter: true,
  status: "ok",
  lastCheckAt: null,
  lastError: null,
  secret: { configured: true },
  applied: true,
}));
const FAKE_NUMBERS = Array.from({ length: 8 }, (_, n) => ({
  id: fakeId(100 + n),
  e164: `+55313222110${n}`,
  trunkId: fakeId(1 + (n % 3)),
  agentId: null,
  agentName: null,
  mode: "ai",
  ivrMenuId: null,
}));
const FAKE_MENUS = [1, 2, 3].map((n) => ({
  id: fakeId(200 + n),
  name: `Menu simulado ${n}`,
  language: "pt-BR",
  timeoutMs: 5000,
  maxAttempts: 2,
  onNoChoice: "person",
  promptAudioMs: null,
  updatedAt: "2026-11-21T00:00:00.000Z",
  options: ["1", "2", "3"].map((digit) => ({ digit, label: `Opção ${digit}`, action: "hangup", agentId: null, transferTo: null })),
}));

/**
 * Segura as três leituras dos blocos acima da ligação pelo WhatsApp (linhas, números e menus) por
 * mais de um segundo, e devolve listas que fazem esses blocos crescerem bem além da tela: é o
 * empurrão que o "mudou para…" sofreria numa instalação com dados. Só a tela vê as listas.
 */
async function holdAboveReads(page: Page): Promise<void> {
  const lists: Record<string, unknown[]> = { trunks: FAKE_TRUNKS, "phone-numbers": FAKE_NUMBERS, "ivr-menus": FAKE_MENUS };
  for (const [path, list] of Object.entries(lists)) {
    await page.route(`**/api/v1/${path}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.fulfill({ json: { ok: true, data: list } });
    });
  }
}

/** Espera as leituras chegarem e confere que os blocos de cima empurraram o da ligação para baixo da dobra. */
async function expectAboveReadsPushedAnchorDown(page: Page): Promise<Locator> {
  await expect(page.getByText(FAKE_MENUS[2]?.name ?? "", { exact: true }).first()).toBeAttached();
  await expect(page.getByRole("heading", { name: FAKE_TRUNKS[2]?.name ?? "", exact: true })).toBeAttached();
  const anchor = page.locator("#ligacao-pelo-whatsapp");
  const fold = page.viewportSize()?.height ?? 0;
  // Sem isto o teste não prova nada: o bloco tem de estar mais abaixo do que cabe numa tela.
  expect(await anchor.evaluate((element) => element.getBoundingClientRect().top + window.scrollY)).toBeGreaterThan(fold * 2);
  return anchor;
}

/** Depois das leituras, o título do bloco da ligação pelo WhatsApp está na tela. */
async function expectAnchorShownAfterReads(page: Page): Promise<void> {
  const anchor = await expectAboveReadsPushedAnchorDown(page);
  await expect(anchor.getByRole("heading", { name: whatsappCalls.title, exact: true })).toBeInViewport();
}

test("pelo \"mudou para…\" até /line#ligacao-pelo-whatsapp, com as leituras de cima atrasadas e grandes: o bloco fica na tela depois que elas chegam", async ({ page }) => {
  await signIn(page);
  await holdAboveReads(page);
  await page.goto("/settings/whatsapp");
  await page.getByRole("status").filter({ hasText: settings.movedWhatsAppCalls }).getByRole("link", { name: settings.movedLink, exact: true }).click();
  await expect(page).toHaveURL(/\/line#ligacao-pelo-whatsapp$/);
  await expectAnchorShownAfterReads(page);
});

test("direto em /line#ligacao-pelo-whatsapp, com as leituras de cima atrasadas e grandes: o bloco fica na tela depois que elas chegam", async ({ page }) => {
  await signIn(page);
  await holdAboveReads(page);
  // Como quem abre o link guardado: a página carrega do zero, já com o endereço do bloco.
  await page.goto("/line#ligacao-pelo-whatsapp");
  await expectAnchorShownAfterReads(page);
});

test("em /line sem endereço de bloco, com as mesmas leituras atrasadas e grandes: a página fica no topo, e o bloco da ligação pelo WhatsApp fora da tela", async ({ page }) => {
  await signIn(page);
  await holdAboveReads(page);
  await page.goto("/line");
  const anchor = await expectAboveReadsPushedAnchorDown(page);
  await expect(page.getByRole("heading", { name: line.title, exact: true })).toBeInViewport();
  await expect(anchor).not.toBeInViewport();
});

test("o aviso de gravação mora em Privacidade e dados, acima da gravação; Regras das ligações aponta para lá, e salvar o texto persiste", async ({ page }) => {
  await signIn(page);
  const before = ((await (await page.request.get(RECORDING_NOTICE)).json()) as { data: { value: string | null } }).data.value;
  try {
    // B4: em Regras das ligações, o bloco saiu e o "mudou para…" leva até ele.
    await openSection(page, "rules", "/settings/calls", settings.sections.calls);
    await expect(page.getByRole("heading", { name: settings.recordingTitle, exact: true })).toHaveCount(0);
    const moved = page.getByRole("status").filter({ hasText: settings.movedRecordingNotice });
    await expect(moved).toBeVisible();
    await moved.getByRole("link", { name: settings.movedLink, exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/privacy#aviso-de-gravacao$/);
    const block = page.locator("#aviso-de-gravacao");
    await expect(block.getByRole("heading", { name: settings.recordingTitle, exact: true })).toBeInViewport();

    // B3: logo acima da gravação das chamadas, o primeiro bloco do painel de privacidade.
    const headings = page.getByRole("main").getByRole("heading", { level: 2 });
    await expect(headings.nth(0)).toHaveText(settings.recordingTitle);
    await expect(headings.nth(1)).toHaveText(privacy.recordingTitle);

    // Salvar o texto funciona, e ele volta depois de recarregar.
    const text = `Esta ligação é atendida por uma assistente virtual ${unique()}.`;
    const field = block.getByLabel(settings.recordingText);
    await expect(field).toHaveValue(before ?? "");
    await field.fill(text);
    await block.getByRole("button", { name: settings.saveRecording, exact: true }).click();
    await expect(block.getByRole("status").filter({ hasText: common.actions.saved })).toBeVisible();
    await page.reload();
    await expect(page.locator("#aviso-de-gravacao").getByLabel(settings.recordingText)).toHaveValue(text);
  } finally {
    await page.request.put(RECORDING_NOTICE, { data: { value: before } });
  }
});

test("o operador lê o aviso de gravação em Privacidade e dados, vê para onde ele foi, e não vê a ligação pelo WhatsApp", async ({ page }) => {
  const text = `Aviso lido pelo operador ${unique()}.`;
  await signIn(page);
  const before = ((await (await page.request.get(RECORDING_NOTICE)).json()) as { data: { value: string | null } }).data.value;
  expect((await page.request.put(RECORDING_NOTICE, { data: { value: text } })).status()).toBe(200);
  try {
    await signInAsOperator(page);
    // B4, para o operador: o "mudou para…" é para todos, e leva ao texto, que ele lê sem editar.
    await page.goto("/settings/calls");
    await page.getByRole("status").filter({ hasText: settings.movedRecordingNotice }).getByRole("link", { name: settings.movedLink, exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/privacy#aviso-de-gravacao$/);
    const field = page.locator("#aviso-de-gravacao").getByLabel(settings.recordingText);
    await expect(field).toHaveValue(text);
    await expect(field).toBeDisabled();
    await expect(page.getByRole("button", { name: settings.saveRecording, exact: true })).toHaveCount(0);

    // A ligação pelo WhatsApp continua só para quem configura: nem na Linha, nem o "mudou para…".
    await page.goto("/line");
    await expect(page.getByRole("heading", { level: 1, name: line.title, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: whatsappCalls.title, exact: true })).toHaveCount(0);
    await page.goto("/settings/whatsapp");
    await expect(page.getByRole("heading", { level: 1, name: settings.sections.whatsapp, exact: true })).toBeVisible();
    await expect(page.getByText(settings.movedWhatsAppCalls)).toHaveCount(0);
  } finally {
    await page.context().clearCookies();
    await signIn(page);
    await page.request.put(RECORDING_NOTICE, { data: { value: before } });
  }
});

test("subtelas de Configurações: sem barra de abas, com o nome no título e \"← Configurações\" de volta à central", async ({ page }) => {
  await signIn(page);
  const sections = [
    { card: "rules", path: "/settings/calls", title: settings.sections.calls, heading: settings.approvalTitle },
    { card: "whatsapp", path: "/settings/whatsapp", title: settings.sections.whatsapp, heading: settings.whatsappTitle },
    { card: "webhooks", path: "/settings/integrations", title: settings.sections.integrations, heading: settings.webhooksTitle },
    { card: "privacy", path: "/settings/privacy", title: settings.sections.privacy, heading: privacy.retentionTitle },
    { card: "engines", path: "/settings/ai", title: settings.sections.ai, heading: settings.enginesTitle },
    { card: "outcome", path: "/settings/after-call", title: settings.hub.cards.outcome.title, heading: settings.outcomeTitle },
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

/** A subtela que só redireciona (central de configuração, parte 8): o endereço antigo da tela de atualizar. */
const REDIRECT_ONLY = "/settings/system";

test("nenhuma tela de Configurações fica órfã: cada subtela tem um cartão na central, e a conta tem o bloco da conta", async ({ page }) => {
  expect(SUBSCREENS).toHaveLength(12);
  await signIn(page);
  await page.goto("/settings");
  await expect(hubCard(page, "engines")).toBeVisible();
  const cards = await page.locator("[data-card]").evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).pathname));
  const account = await page.locator("aside").getByRole("link", { name: common.shell.myAccount, exact: true }).getAttribute("href");
  // "/settings/system" não tem cartão: só redireciona, para a área da instalação ou de volta à central
  // (parte 8). Ela fica de fora pelo nome, e o redirecionamento tem o teste dele em
  // `installation-area.spec.ts`.
  expect(cards).not.toContain(REDIRECT_ONLY);
  const reached = new Set([...cards, account, REDIRECT_ONLY]);
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
    { key: "outcome", path: "/settings/after-call", heading: settings.outcomeTitle },
    { key: "whatsapp", path: "/settings/whatsapp", heading: whatsapp.title },
    { key: "webhooks", path: "/settings/integrations", heading: settings.webhooksTitle },
    { key: "rules", path: "/settings/calls", heading: settings.inboundLimitTitle },
    { key: "privacy", path: "/settings/privacy", heading: privacy.retentionTitle },
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

    await openSection(page, "outcome", "/settings/after-call", settings.hub.cards.outcome.title);
    await expect(blockHeading(page, settings.outcomeTitle)).toBeVisible();
    for (const label of [settings.outcomeSwitch, settings.analysisSwitch, settings.transcriptionSwitch, settings.autoTranscriptionSwitch])
      await expect(page.getByRole("switch", { name: label, exact: true }), label).toHaveAttribute("aria-checked", "true");

    // Desligar na tela nova grava na mesma chave (`null`, que a leitura devolve como o padrão `false`),
    // e a leitura de volta concorda.
    await page.getByRole("switch", { name: settings.outcomeSwitch, exact: true }).click();
    await expect(page.getByRole("switch", { name: settings.outcomeSwitch, exact: true })).toHaveAttribute("aria-checked", "false");
    expect(await readSetting(page, "calls.outcome_enabled")).toBe(false);
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
