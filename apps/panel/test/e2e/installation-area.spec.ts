import { expect, test, type Locator, type Page } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import installation from "../../src/i18n/pt-BR/installation";
import update from "../../src/i18n/pt-BR/update";
import { signIn, unique } from "./session";

// A navegação principal de antes da área da instalação (R8, fatia 2), escrita aqui por extenso: um
// item novo nela reprova este teste, e não passa despercebido por vir da mesma lista do menu.
const MAIN_NAV_BEFORE = [
  common.nav.calls,
  common.nav.approvals,
  common.nav.followUps,
  common.nav.agents,
  common.nav.line,
  common.nav.outbound,
  common.nav.costs,
  common.nav.team,
  common.nav.settings,
];
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** O dono da fundadora convida um operador, e a página segue com a sessão dele (como no #518). */
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

// O CI não dá ao e2e o segredo do agente, então o aviso de atualização não nasce de verdade aqui: a
// lista do sino é servida pelo teste, com um aviso de atualização e um de serviço, sem assunto.
const UPDATE_NOTICE = "A atualização do DeskVoice começou. Quem administra a instalação acompanha o resultado em Administrar a instalação → Atualização.";
const SERVICE_NOTICE = "O serviço de WhatsApp está instalado neste servidor. Conecte um número em Configurações → WhatsApp.";
async function serveBell(page: Page): Promise<void> {
  const base = { callId: null, createdAt: "2026-11-21T12:00:00.000Z", readAt: null, followUpId: null, followUpTitle: null, followUpStatus: null };
  const list = [
    { ...base, id: "00000000-0000-4000-8000-000000000001", body: UPDATE_NOTICE, subject: "installation_update" },
    { ...base, id: "00000000-0000-4000-8000-000000000002", body: SERVICE_NOTICE, subject: null },
  ];
  await page.route("**/api/v1/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: list }) }));
}
const openBell = async (page: Page): Promise<Locator> => {
  const aside = page.locator("aside");
  await aside.locator(`summary[aria-label="${common.shell.notifications}"]`).click();
  return aside.locator("details[open]");
};

// A instalação do CI tem uma organização só e ninguém marcado: o dono administra pela regra da
// fundadora. Este teste nunca cria a segunda organização, porque isso fixa a lista para sempre.
test("com uma organização só, a navegação principal é a de antes, e a área da instalação mora no bloco da conta", async ({ page }) => {
  await signIn(page);
  await page.goto("/calls");

  const main = page.getByRole("navigation", { name: common.shell.mainNav });
  // O item de Aprovações pode trazer a contagem ao lado do nome.
  await expect(main.getByRole("link")).toHaveText(MAIN_NAV_BEFORE.map((label) => new RegExp(`^${escape(label)}\\d*$`)));
  await expect(main).not.toContainText(installation.menu);
  // Os itens moram em quatro grupos, na ordem do desenho da central de configuração (parte 1), e o
  // título do grupo é rótulo: nunca link.
  await expect(main.getByRole("group")).toHaveCount(4);
  for (const [group, count] of [[common.navGroups.attend, 3], [common.navGroups.build, 3], [common.navGroups.follow, 1], [common.navGroups.organization, 2]] as const) {
    await expect(main.getByRole("group", { name: group }).getByRole("link")).toHaveCount(count);
  }
  await expect(main.getByRole("link", { name: common.navGroups.attend })).toHaveCount(0);

  // A tela de atualizar mora só na área da instalação, também com a lista implícita (central de
  // configuração, parte 8): o endereço antigo leva o dono da fundadora até ela, e a Central não tem
  // mais o cartão "Sistema".
  await page.goto("/settings/system");
  await expect(page).toHaveURL(/\/installation\/update$/);
  await expect(page.getByRole("heading", { name: update.title, exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: installation.sectionsNav }).getByRole("link", { name: installation.sections.update })).toHaveAttribute("aria-current", "page");
  await page.goto("/settings");
  await expect(page.locator('[data-card="engines"]')).toBeVisible();
  await expect(page.locator('[data-card="system"]')).toHaveCount(0);

  await page.getByRole("link", { name: installation.menu }).click();
  await expect(page).toHaveURL(/\/installation$/);
  await expect(page.getByRole("heading", { level: 1, name: installation.title })).toBeVisible();
  const sections = page.getByRole("navigation", { name: installation.sectionsNav }).getByRole("link");
  await expect(sections).toHaveText([installation.sections.organizations, installation.sections.overview, installation.sections.admins, installation.sections.audit, installation.sections.update]);
  await expect(page.getByText(installation.organizations.founding, { exact: true })).toBeVisible();

  await sections.filter({ hasText: installation.sections.admins }).click();
  await expect(page.getByText(installation.admins.implicit)).toBeVisible();
});

// Quem não administra a instalação (aqui, um operador da fundadora com a lista implícita): o endereço
// antigo da tela de atualizar volta à central, sem cartão "Sistema", a versão aparece sem link, e a
// área da instalação responde "não encontrado" (central de configuração, parte 8).
test("quem não administra a instalação não chega à tela de atualizar por nenhum caminho", async ({ page }) => {
  await signInAsOperator(page);

  await page.goto("/settings/system");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('[data-card="engines"]')).toBeVisible();
  await expect(page.locator('[data-card="system"]')).toHaveCount(0);

  const aside = page.locator("aside");
  // O indicador mostra a versão em execução, e não é link.
  const version = aside.getByText(new RegExp(`^${escape(common.shell.versionShort.split("{version}")[0] ?? "")}`));
  await expect(version).toBeVisible();
  await expect(aside.getByRole("link").filter({ has: version })).toHaveCount(0);
  await expect(aside.locator('a[href="/installation/update"], a[href="/settings/system"]')).toHaveCount(0);
  await expect(aside.getByRole("link", { name: installation.menu })).toHaveCount(0);

  const response = await page.goto("/installation/update");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: update.title, exact: true })).toHaveCount(0);
});

// O aviso de atualização vai para todos, e só quem administra a instalação ganha o link para a tela do
// resultado (central de configuração, parte 8 · acompanhamento).
test("no sino, o dono da fundadora segue o aviso de atualização até a tela do resultado", async ({ page }) => {
  await serveBell(page);
  await signIn(page);
  await page.goto("/calls");
  const bell = await openBell(page);
  const updateNotice = bell.getByText(UPDATE_NOTICE, { exact: true }).locator("..");
  const serviceNotice = bell.getByText(SERVICE_NOTICE, { exact: true }).locator("..");
  await expect(updateNotice.getByRole("link", { name: common.shell.openUpdate })).toHaveAttribute("href", "/installation/update");
  await expect(serviceNotice.getByRole("link", { name: common.shell.openUpdate })).toHaveCount(0);
  await expect(bell.getByRole("link", { name: common.shell.openUpdate })).toHaveCount(1);
  await updateNotice.getByRole("link", { name: common.shell.openUpdate }).click();
  await expect(page).toHaveURL(/\/installation\/update$/);
  await expect(page.getByRole("heading", { name: update.title, exact: true })).toBeVisible();
});

test("no sino, quem não administra a instalação lê o aviso de atualização, sem link", async ({ page }) => {
  await signInAsOperator(page);
  await serveBell(page);
  await page.goto("/calls");
  const bell = await openBell(page);
  await expect(bell.getByText(UPDATE_NOTICE)).toBeVisible();
  await expect(bell.getByText(SERVICE_NOTICE)).toBeVisible();
  await expect(bell.getByRole("link", { name: common.shell.openUpdate })).toHaveCount(0);
  await expect(bell.locator('a[href^="/installation"], a[href="/settings/system"]')).toHaveCount(0);
});
