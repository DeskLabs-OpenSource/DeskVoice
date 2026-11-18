import { expect, test } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import installation from "../../src/i18n/pt-BR/installation";
import settings from "../../src/i18n/pt-BR/settings";
import { signIn } from "./session";

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

// A instalação do CI tem uma organização só e ninguém marcado: o dono administra pela regra da
// fundadora. Este teste nunca cria a segunda organização, porque isso fixa a lista para sempre.
test("com uma organização só, a navegação principal é a de antes, e a área da instalação mora no bloco da conta", async ({ page }) => {
  await signIn(page);
  await page.goto("/calls");

  const main = page.getByRole("navigation", { name: common.shell.mainNav });
  // O item de Aprovações pode trazer a contagem ao lado do nome.
  await expect(main.getByRole("link")).toHaveText(MAIN_NAV_BEFORE.map((label) => new RegExp(`^${escape(label)}\\d*$`)));
  await expect(main).not.toContainText(installation.menu);

  // A tela de atualizar continua onde estava enquanto a lista não é explícita.
  await page.goto("/settings/system");
  await expect(page.getByRole("navigation", { name: settings.sectionsNav }).getByRole("link", { name: settings.sections.system })).toBeVisible();

  await page.getByRole("link", { name: installation.menu }).click();
  await expect(page).toHaveURL(/\/installation$/);
  await expect(page.getByRole("heading", { level: 1, name: installation.title })).toBeVisible();
  const sections = page.getByRole("navigation", { name: installation.sectionsNav }).getByRole("link");
  await expect(sections).toHaveText([installation.sections.organizations, installation.sections.overview, installation.sections.admins, installation.sections.audit]);
  await expect(page.getByText(installation.organizations.founding, { exact: true })).toBeVisible();

  await sections.filter({ hasText: installation.sections.admins }).click();
  await expect(page.getByText(installation.admins.implicit)).toBeVisible();
});
