import { expect, test, type Page } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import installation from "../../src/i18n/pt-BR/installation";
import invite from "../../src/i18n/pt-BR/invite";
import { fill } from "../../src/i18n/locales";
import team from "../../src/i18n/pt-BR/team";
import { signIn, unique } from "./session";

const org = installation.organizations;

// Critério 1 da seção 4 do desenho do R8 (fatia 3): quem administra a instalação cria duas
// organizações e convida a mesma pessoa para as duas. Ela aceita o segundo convite com a senha que
// já tem, troca entre as duas pelo seletor, sem sair, e em cada uma vê só o que é dela.
//
// ATENÇÃO À ORDEM: criar organização fixa a lista de quem administra a instalação para sempre, e
// `installation-area.spec.ts` conta com a lista implícita. Os testes de tela rodam em série, na ordem
// dos nomes dos arquivos, e este nome vem depois de todos os outros. Um arquivo novo que dependa da
// lista implícita precisa vir antes deste na ordem alfabética.

/** O caminho do link do convite: a página abre pelo endereço do teste, qualquer que seja o do link. */
const pathOf = (link: string): string => new URL(link).pathname;

async function createOrganization(page: Page, name: string): Promise<void> {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: org.create, exact: true }) });
  await form.getByLabel(org.nameLabel, { exact: true }).fill(name);
  await form.getByRole("button", { name: org.create, exact: true }).click();
  // Se a lista de quem administra ainda é implícita, a tela mostra quem muda e pede a confirmação.
  const confirm = page.getByRole("button", { name: org.confirm, exact: true });
  const created = page.getByText(fill(org.createdTitle, { name }), { exact: true });
  await expect(confirm.or(created)).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
  await expect(created).toBeVisible();
}

async function firstOwnerLink(page: Page, organization: string, email: string): Promise<string> {
  await page.getByRole("listitem").filter({ hasText: organization }).getByRole("button", { name: org.inviteOwner, exact: true }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: org.inviteSend, exact: true }) });
  await form.getByLabel(org.inviteName, { exact: true }).fill("Pessoa das duas");
  await form.getByLabel(org.inviteEmail, { exact: true }).fill(email);
  await form.getByRole("button", { name: org.inviteSend, exact: true }).click();
  const link = await page.getByLabel(org.linkLabel).inputValue();
  await page.getByRole("button", { name: org.close, exact: true }).click();
  return link;
}

/** Espera a lista de organizações da sessão chegar à tela: só depois dela a ausência do seletor vale. */
const organizationsListed = (page: Page) => page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/organizations") && response.ok());

test("a mesma pessoa em duas organizações: aceita o segundo convite com a senha que já tem, troca pelo seletor e em cada uma vê só o que é dela", async ({ page }) => {
  const id = unique();
  const first = `Cliente A ${id}`;
  const second = `Cliente B ${id}`;
  const email = `duas-${id}@example.test`;
  const password = `senha de teste ${id}`;
  const onlyInSecond = `so-em-b-${id}@example.test`;

  // Quem administra a instalação cria as duas e gera os dois convites para o mesmo e-mail.
  await signIn(page);
  await page.goto("/installation");
  await createOrganization(page, first);
  await createOrganization(page, second);
  const firstLink = await firstOwnerLink(page, first, email);
  const secondLink = await firstOwnerLink(page, second, email);
  await page.context().clearCookies();

  // O primeiro convite cria a conta, com a senha nova. Com um vínculo só, não há seletor.
  await page.goto(pathOf(firstLink));
  await expect(page.getByRole("heading", { level: 1, name: invite.title })).toBeVisible();
  // O nome acessível do campo com dica inclui a dica, por isso o nome inteiro.
  await page.getByRole("textbox", { name: `${invite.password} ${invite.passwordHint}`, exact: true }).fill(password);
  await page.getByLabel(invite.repeat, { exact: true }).fill(password);
  let listed = organizationsListed(page);
  await page.getByRole("button", { name: invite.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/calls$/);
  await listed;
  await expect(page.getByRole("combobox", { name: common.shell.organization })).toHaveCount(0);

  // O segundo convite mostra a mesma página: a pessoa digita duas vezes a senha que a conta já tem.
  await page.goto(pathOf(secondLink));
  await expect(page.getByText(fill(invite.lead, { organization: second }), { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: `${invite.password} ${invite.passwordHint}`, exact: true }).fill(password);
  await page.getByLabel(invite.repeat, { exact: true }).fill(password);
  listed = organizationsListed(page);
  await page.getByRole("button", { name: invite.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/calls$/);
  await listed;

  // A sessão nasceu na segunda. Lá, a pessoa deixa uma marca que só a segunda tem: um convite pendente.
  const selector = page.getByRole("combobox", { name: common.shell.organization });
  await expect(selector.locator("option:checked")).toHaveText(second);
  await expect(selector.locator("option")).toHaveText([first, second]);
  await page.goto("/team");
  await page.getByRole("button", { name: team.invite, exact: true }).click();
  await page.getByLabel(team.email, { exact: true }).fill(onlyInSecond);
  await page.getByLabel(team.name, { exact: true }).fill("Só da B");
  await page.getByRole("button", { name: team.createInvite, exact: true }).click();
  await page.getByRole("button", { name: team.done, exact: true }).click();
  await expect(page.getByText(onlyInSecond, { exact: true })).toBeVisible();

  // Troca para a primeira pelo seletor, sem sair: a página recarrega na mesma seção, e a marca da segunda não aparece.
  await selector.selectOption({ label: first });
  await expect(selector.locator("option:checked")).toHaveText(first);
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.getByRole("heading", { name: team.peopleTitle, exact: true })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByText(onlyInSecond, { exact: true })).toHaveCount(0);

  // E volta: a marca da segunda continua lá.
  await selector.selectOption({ label: second });
  await expect(selector.locator("option:checked")).toHaveText(second);
  await expect(page.getByText(onlyInSecond, { exact: true })).toBeVisible();
});
