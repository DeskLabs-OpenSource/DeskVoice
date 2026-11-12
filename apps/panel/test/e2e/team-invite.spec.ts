import { expect, test } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import { fill } from "../../src/i18n/locales";
import team from "../../src/i18n/pt-BR/team";
import { signIn, unique } from "./session";

test("equipe: o link do convite aparece uma vez, e revogar pede confirmação nomeando a pessoa", async ({ page }) => {
  const id = unique();
  const name = `Pessoa de teste ${id}`;
  const email = `convite-${id}@example.test`;
  await signIn(page);
  await page.goto("/team");
  await expect(page.getByRole("heading", { level: 1, name: team.title })).toBeVisible();

  await page.getByRole("button", { name: team.invite, exact: true }).click();
  await page.getByLabel(team.email, { exact: true }).fill(email);
  await page.getByLabel(team.name, { exact: true }).fill(name);
  await page.getByRole("button", { name: team.createInvite, exact: true }).click();

  await expect(page.getByRole("heading", { name: fill(team.linkTitle, { name }) })).toBeVisible();
  await expect(page.getByLabel(team.linkLabel)).toHaveValue(/\/invite\/[^/]+$/);
  // Uma vez só: fechado o aviso, ou recarregada a tela, o link não volta.
  await page.getByRole("button", { name: team.done, exact: true }).click();
  await expect(page.getByLabel(team.linkLabel)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: team.pendingTitle })).toBeVisible();
  await expect(page.getByLabel(team.linkLabel)).toHaveCount(0);

  const revoke = page.getByRole("button", { name: fill(team.revoke, { name }), exact: true });
  const confirmation = page.getByText(fill(team.revokeConfirm, { name, email }), { exact: true });
  await revoke.click();
  await expect(confirmation).toBeVisible();
  // Cancelar não revoga: o convite continua lá depois de recarregar.
  await page.getByRole("button", { name: common.actions.cancel, exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await page.reload();
  await expect(revoke).toBeVisible();

  await revoke.click();
  await page.getByRole("button", { name: team.revokeYes, exact: true }).click();
  await expect(revoke).toHaveCount(0);
  await page.reload();
  // A lista de pessoas na tela prova que os dados chegaram: só então a ausência do convite vale.
  await expect(page.getByRole("heading", { name: team.peopleTitle, exact: true })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
});
