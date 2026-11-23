import { expect, test, type Page } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import installation from "../../src/i18n/pt-BR/installation";
import invite from "../../src/i18n/pt-BR/invite";
import { fill } from "../../src/i18n/locales";
import { signIn, unique } from "./session";

const org = installation.organizations;

// Fatia 4b do R8 (seção 3.3 do desenho): quem administra a instalação suspende um cliente pela
// área da instalação, com a confirmação que nomeia a organização; quem é só daquele cliente passa a
// ver a tela de suspensa, com o motivo, e mais nada; a reativação devolve o painel.
//
// ATENÇÃO À ORDEM: criar organização fixa a lista de quem administra a instalação para sempre, e
// `installation-area.spec.ts` conta com a lista implícita. Os testes de tela rodam em série, na ordem
// dos nomes dos arquivos: este nome vem depois de todos os que dependem da lista implícita.

const pathOf = (link: string): string => new URL(link).pathname;

async function createOrganization(page: Page, name: string): Promise<void> {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: org.create, exact: true }) });
  await form.getByLabel(org.nameLabel, { exact: true }).fill(name);
  await form.getByRole("button", { name: org.create, exact: true }).click();
  const confirm = page.getByRole("button", { name: org.confirm, exact: true });
  const created = page.getByText(fill(org.createdTitle, { name }), { exact: true });
  await expect(confirm.or(created)).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
  await expect(created).toBeVisible();
}

const rowOf = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });

test("suspender um cliente: a confirmação nomeia a organização, quem é só dele vê a tela de suspensa, e a reativação devolve o painel", async ({ page }) => {
  const id = unique();
  const client = `Cliente suspenso ${id}`;
  const email = `suspensa-${id}@example.test`;
  const password = `senha de teste ${id}`;
  const reason = `Contrato pausado a pedido do cliente ${id}`;

  // Quem administra a instalação cria o cliente e o convite do primeiro dono.
  await signIn(page);
  await page.goto("/installation");
  await createOrganization(page, client);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: org.inviteSend, exact: true }) });
  await form.getByLabel(org.inviteName, { exact: true }).fill("Dona do cliente");
  await form.getByLabel(org.inviteEmail, { exact: true }).fill(email);
  await form.getByRole("button", { name: org.inviteSend, exact: true }).click();
  const link = await page.getByLabel(org.linkLabel).inputValue();
  await page.context().clearCookies();

  // A dona aceita: a conta dela só tem este cliente.
  await page.goto(pathOf(link));
  await page.getByRole("textbox", { name: `${invite.password} ${invite.passwordHint}`, exact: true }).fill(password);
  await page.getByLabel(invite.repeat, { exact: true }).fill(password);
  await page.getByRole("button", { name: invite.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/calls$/);
  await page.context().clearCookies();

  // A suspensão: o botão só abre a confirmação, que nomeia o cliente e diz o que é cancelado.
  await signIn(page);
  await page.goto("/installation");
  await rowOf(page, client).getByRole("button", { name: org.suspend, exact: true }).click();
  await expect(page.getByText(fill(org.suspendTitle, { name: client }), { exact: true })).toBeVisible();
  await expect(page.getByText(org.suspendNoReturn)).toBeVisible();
  const suspendButton = page.getByRole("button", { name: fill(org.suspendYes, { name: client }), exact: true });
  await expect(suspendButton).toBeDisabled();
  await page.getByRole("textbox", { name: `${org.reasonLabel} ${org.reasonHint}`, exact: true }).fill(reason);
  await suspendButton.click();
  await expect(page.getByText(fill(org.suspendedDone, { name: client, n: 0 }), { exact: true })).toBeVisible();
  await expect(rowOf(page, client).getByText(org.suspended, { exact: true })).toBeVisible();
  await expect(rowOf(page, client).getByText(fill(org.suspendedReason, { reason }), { exact: true })).toBeVisible();
  await page.context().clearCookies();

  // Quem é só do cliente suspenso vê o nome, o motivo e mais nada: nem a navegação principal.
  const login = await page.request.post("/api/v1/auth/login", { data: { email, password } });
  expect(login.status()).toBe(200);
  await page.goto("/calls");
  await expect(page.getByRole("heading", { level: 1, name: common.suspended.title })).toBeVisible();
  await expect(page.getByText(fill(common.suspended.lead, { name: client }), { exact: true })).toBeVisible();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: common.shell.mainNav })).toHaveCount(0);
  await page.context().clearCookies();

  // A reativação: confirmação com o nome, e o painel volta para a dona.
  await signIn(page);
  await page.goto("/installation");
  await rowOf(page, client).getByRole("button", { name: org.reactivate, exact: true }).click();
  await expect(page.getByText(fill(org.reactivateTitle, { name: client }), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: fill(org.reactivateYes, { name: client }), exact: true }).click();
  await expect(page.getByText(fill(org.reactivatedDone, { name: client, n: 0 }), { exact: true })).toBeVisible();
  await page.context().clearCookies();

  expect((await page.request.post("/api/v1/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto("/calls");
  await expect(page.getByRole("navigation", { name: common.shell.mainNav }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: common.suspended.title })).toHaveCount(0);
});
