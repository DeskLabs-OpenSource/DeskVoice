import { expect, test, type Page } from "@playwright/test";
import { CALLER_MESSAGE_ORG_PER_DAY, CALLER_MESSAGE_ORG_PER_HOUR, DROP_FOLLOW_UP_DEFAULT_MESSAGE } from "@deskvoice/core/drop-follow-up";
import { fill } from "../../src/i18n/locales";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import settings from "../../src/i18n/pt-BR/settings";
import { signIn, unique } from "./session";

// "Quando a ligação cai", a opção do WhatsApp para quem ligou (desenho
// 2026-11-16-follow-up-da-ligacao-que-caiu, seções 3.5 e 3.8, fatia 2): sem o pré-requisito, ela aparece
// desabilitada e diz por quê; com ele, o operador escolhe e escreve o texto.

const putSetting = async (page: Page, key: string, value: unknown) => expect((await page.request.put(`/api/v1/settings/${key}`, { data: { value } })).status()).toBe(200);

const save = async (page: Page) => {
  const patch = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/v1\/agents\/[^/]+$/.test(request.url()));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: common.actions.saved })).toHaveText(common.actions.saved);
  return (await patch).postDataJSON() as { dropFollowUp?: string; dropFollowUpMessage?: string | null };
};

test("WhatsApp para quem ligou: desabilitada com o motivo sem o pré-requisito, e escolhida com o texto quando ele existe", async ({ page }) => {
  await signIn(page);
  await putSetting(page, "whatsapp.connector", null);
  await putSetting(page, "whatsapp.trust_caller_id", null);
  try {
    const created = await page.request.post("/api/v1/agents", { data: { name: `Queda ${unique()}`, engine: "simulated" } });
    const agentId = ((await created.json()) as { data: { id: string } }).data.id;

    await page.goto(`/agents/${agentId}?aba=depois`);
    const field = page.getByRole("combobox", { name: agents.dropFollowUp });
    await expect(field).toHaveValue("off");
    await expect(page.getByText(agents.dropFollowUpDefinition)).toBeVisible();
    const option = field.locator('option[value="whatsapp"]');
    await expect(option).toBeDisabled();
    await expect(option).toHaveText(`${agents.dropFollowUpWhatsApp} (${agents.dropFollowUpWhatsAppUnavailable})`);
    await expect(page.getByText(agents.dropFollowUpNotConnected)).toBeVisible();
    await expect(page.getByRole("link", { name: agents.dropFollowUpFixLink })).toHaveAttribute("href", "/settings/whatsapp");
    // O resto da tela continua salvando, e o modo que não mudou não vai no pedido.
    expect((await save(page)).dropFollowUp).toBeUndefined();

    // Com o conector, falta a confiança no número: o motivo muda.
    await putSetting(page, "whatsapp.connector", { type: "webhook", url: "https://hooks.example.test/wa", token: "e2e-token" });
    await page.reload();
    await expect(page.getByText(agents.dropFollowUpNotTrusted)).toBeVisible();
    await expect(page.getByRole("combobox", { name: agents.dropFollowUp }).locator('option[value="whatsapp"]')).toBeDisabled();
    // O caminho leva a "Confiar no número", que fica no Avançado: o link traz a âncora, e o bloco chega aberto.
    await expect(page.getByRole("link", { name: agents.dropFollowUpFixLink })).toHaveAttribute("href", "/settings/whatsapp#avancado");
    await page.getByRole("link", { name: agents.dropFollowUpFixLink }).click();
    await expect(page).toHaveURL(/\/settings\/whatsapp#avancado$/);
    await expect(page.getByRole("switch", { name: settings.trustCallerSwitch })).toBeVisible();
    // A pessoa continua podendo fechar o bloco.
    await page.locator("#avancado > summary").click();
    await expect(page.getByRole("switch", { name: settings.trustCallerSwitch })).toBeHidden();
    // Sem a âncora, a tela abre com o Avançado fechado: o conector externo e a chave não aparecem.
    await page.goto("/settings/whatsapp");
    await expect(page.getByRole("heading", { name: settings.whatsappTitle, exact: true })).toBeVisible();
    await expect(page.getByLabel(settings.url, { exact: true })).toBeHidden();
    await expect(page.getByRole("switch", { name: settings.trustCallerSwitch })).toBeHidden();
    await page.goto(`/agents/${agentId}?aba=depois`);

    // Com os dois, a opção vale, e o campo do texto aparece com o aviso e o texto padrão como exemplo.
    await putSetting(page, "whatsapp.trust_caller_id", true);
    await page.reload();
    await expect(page.getByText(agents.dropFollowUpNotTrusted)).toHaveCount(0);
    await page.getByRole("combobox", { name: agents.dropFollowUp }).selectOption({ label: agents.dropFollowUpWhatsApp });
    const text = page.getByRole("textbox", { name: agents.dropFollowUpMessage });
    // O texto padrão diz quem manda: o nome da organização vem da sessão.
    const { organizationName } = ((await (await page.request.get("/api/v1/auth/me")).json()) as { data: { organizationName: string } }).data;
    expect(organizationName).not.toBe("");
    await expect(text).toHaveAttribute("placeholder", DROP_FOLLOW_UP_DEFAULT_MESSAGE["pt-BR"](organizationName));
    await expect(page.getByText(agents.dropFollowUpMessageWarning)).toBeVisible();
    // O risco de bloqueio e o teto da organização ficam junto da opção.
    await expect(page.getByText(agents.dropFollowUpBlockRisk)).toBeVisible();
    await expect(page.getByText(fill(agents.dropFollowUpMessageLimits, { perHour: CALLER_MESSAGE_ORG_PER_HOUR, perDay: CALLER_MESSAGE_ORG_PER_DAY }))).toBeVisible();
    await text.fill("Sua ligação caiu. Se precisar, ligue de novo.");
    expect(await save(page)).toMatchObject({ dropFollowUp: "whatsapp", dropFollowUpMessage: "Sua ligação caiu. Se precisar, ligue de novo." });

    // O ajuste desligado depois: a opção escolhida continua à vista, com o alerta e o caminho.
    await putSetting(page, "whatsapp.trust_caller_id", false);
    await page.reload();
    await expect(page.getByRole("combobox", { name: agents.dropFollowUp })).toHaveValue("whatsapp");
    await expect(page.getByRole("alert").filter({ hasText: agents.dropFollowUpNotTrusted })).toBeVisible();
    await expect(page.getByRole("alert").getByRole("link", { name: agents.dropFollowUpFixLink })).toHaveAttribute("href", "/settings/whatsapp#avancado");
  } finally {
    await putSetting(page, "whatsapp.trust_caller_id", null);
    await putSetting(page, "whatsapp.connector", null);
  }
});
