import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import { fill } from "../../src/i18n/locales";
import outbound from "../../src/i18n/pt-BR/outbound";
import { formatPhone } from "../../src/ui/format";
import { signIn } from "./session";

// Lei: docs/doctrine/destrutivo-pede-confirmacao.md. Tirar alguém da lista de não ligar desfaz uma
// proteção que a pessoa pediu: o clique na lixeira só pergunta, nomeando o número.
test("lista de não ligar: remover pede confirmação com o número, e cancelar não remove", async ({ page }) => {
  // Número inventado, num fixo de BH com final sorteado: cada execução usa o seu.
  const e164 = `+55313555${String(randomInt(10_000)).padStart(4, "0")}`;
  const number = formatPhone(e164);
  await signIn(page);
  await page.goto("/outbound");
  await expect(page.getByRole("heading", { name: outbound.dncTitle, exact: true })).toBeVisible();

  await page.getByLabel(outbound.dncNumbers).fill(number);
  await page.getByRole("button", { name: outbound.dncAdd, exact: true }).click();
  const remove = page.getByRole("button", { name: fill(outbound.dncRemove, { number }), exact: true });
  await expect(remove).toBeVisible();

  const confirmation = page.getByText(fill(outbound.dncRemoveConfirm, { number }), { exact: true });
  await remove.click();
  await expect(confirmation).toBeVisible();
  await expect(page.getByRole("button", { name: fill(outbound.dncRemoveYes, { number }), exact: true })).toBeVisible();
  // O clique na lixeira não removeu nada, e cancelar também não: o número segue na lista gravada.
  await page.getByRole("button", { name: common.actions.cancel, exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await page.reload();
  await expect(remove).toBeVisible();

  await remove.click();
  await page.getByRole("button", { name: fill(outbound.dncRemoveYes, { number }), exact: true }).click();
  await expect(remove).toHaveCount(0);
  await page.reload();
  // A lista carregada (vazia ou com a contagem) prova que os dados chegaram: só então a ausência vale.
  const listed = new RegExp(`^${outbound.dncCount.replace("{n}", "\\d+")}$`);
  await expect(page.getByText(outbound.dncEmpty, { exact: true }).or(page.getByText(listed))).toBeVisible();
  await expect(page.getByText(number, { exact: true })).toHaveCount(0);
});
