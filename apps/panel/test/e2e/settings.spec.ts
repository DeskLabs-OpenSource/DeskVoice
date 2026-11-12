import { expect, test } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import settings from "../../src/i18n/pt-BR/settings";
import update from "../../src/i18n/pt-BR/update";
import whatsapp from "../../src/i18n/pt-BR/whatsapp";
import { signIn } from "./session";

test("configurar: os blocos de uma instalação nova aparecem, e o limite de ligações recebidas persiste", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: settings.title })).toBeVisible();

  // Motor de voz: numa instalação nova nenhuma chave foi cadastrada.
  await expect(page.getByRole("heading", { name: settings.enginesTitle, exact: true })).toBeVisible();
  await expect(page.getByText(settings.keyMissing, { exact: true }).first()).toBeVisible();
  // Versão e atualização: o bloco carregou (a versão em execução foi lida), e não ficou no esqueleto.
  await expect(page.getByRole("heading", { name: update.title, exact: true })).toBeVisible();
  await expect(page.getByText(update.running, { exact: true })).toBeVisible();
  // WhatsApp: o serviço é opcional e não vem instalado.
  await expect(page.getByRole("heading", { name: whatsapp.title, exact: true })).toBeVisible();
  await expect(page.getByText(whatsapp.serviceAbsent, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: whatsapp.installService, exact: true })).toBeVisible();
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
