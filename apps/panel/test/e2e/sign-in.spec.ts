import { expect, test } from "@playwright/test";
import calls from "../../src/i18n/pt-BR/calls";
import common from "../../src/i18n/pt-BR/common";
import login from "../../src/i18n/pt-BR/login";
import { owner } from "./session";

test("entrar: senha errada é recusada, a certa entra, e sair encerra a sessão", async ({ page }) => {
  const { email, password } = owner();
  await page.goto("/login");

  // `exact` no e-mail: com o erro na tela, o rótulo da senha passa a conter "E-mail ou senha".
  await page.getByLabel(login.email, { exact: true }).fill(email);
  await page.getByLabel(login.password).fill(`${password}-errada`);
  await page.getByRole("button", { name: login.submit, exact: true }).click();
  await expect(page.getByText(common.errors.invalid_credentials, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel(login.password).fill(password);
  await page.getByRole("button", { name: login.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/calls$/);
  await expect(page.getByRole("heading", { level: 1, name: calls.title })).toBeVisible();

  await page.getByRole("button", { name: common.actions.signOut, exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  // A sessão acabou no servidor, e não só na tela: voltar a uma página interna cai na entrada.
  await page.goto("/calls");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: login.title })).toBeVisible();
});
