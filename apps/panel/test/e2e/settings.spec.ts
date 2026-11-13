import { expect, test, type Page } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import privacy from "../../src/i18n/pt-BR/privacy";
import settings from "../../src/i18n/pt-BR/settings";
import update from "../../src/i18n/pt-BR/update";
import whatsapp from "../../src/i18n/pt-BR/whatsapp";
import whatsappCalls from "../../src/i18n/pt-BR/whatsapp-calls";
import { signIn } from "./session";

const sectionLink = (page: Page, name: string) => page.getByRole("navigation", { name: settings.sectionsNav }).getByRole("link", { name, exact: true });

/** Vai à seção pela navegação de Configurações, como quem usa, e confere que ela ficou marcada. */
async function openSection(page: Page, name: string, path: string): Promise<void> {
  await sectionLink(page, name).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(sectionLink(page, name)).toHaveAttribute("aria-current", "page");
}

test("configurar: os blocos de uma instalação nova aparecem, e o limite de ligações recebidas persiste", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: settings.title })).toBeVisible();

  // Inteligência artificial, a seção de `/settings`: numa instalação nova nenhuma chave foi cadastrada.
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
    { name: settings.sections.ai, path: "/settings", heading: settings.enginesTitle },
  ];
  for (const section of sections) {
    await openSection(page, section.name, section.path);
    await expect(page.getByRole("heading", { name: section.heading, exact: true })).toBeVisible();
    // Uma seção marcada por vez.
    await expect(page.getByRole("navigation", { name: settings.sectionsNav }).locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: common.shell.mainNav }).getByRole("link", { name: common.nav.settings })).toHaveAttribute("aria-current", "page");
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
  await page.goto("/settings");
  await expect(page.getByText(settings.keyMissing, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: settings.keyTest, exact: true })).toHaveCount(0);
});
