import { expect, test, type Page } from "@playwright/test";
import settings from "../../src/i18n/pt-BR/settings";
import { signIn } from "./session";

/**
 * O bloco do CRM (#330, fatia 2b) recomeça quando o CRM gravado muda. Sem isso, a conferência e o
 * canal escolhido no CRM antigo ficavam na tela, e "Salvar canal" gravava no CRM novo um
 * `channelSessionId` do antigo. O conector e a conferência são simulados: o teste não fala com CRM.
 */
type Connector = { type: "deskcomm"; url: string; crmUrl: string; channelSessionId?: string; channelLabel?: string };

const CRM_A = "https://crm-a.example.test";
const CRM_B = "https://crm-b.example.test";
const CHANNELS: Record<string, { id: string; provider: string; name: string; phone: null }[]> = {
  [CRM_A]: [
    { id: "canal-a1", provider: "whatsapp", name: "Atendimento A", phone: null },
    { id: "canal-a2", provider: "whatsapp", name: "Vendas A", phone: null },
  ],
  [CRM_B]: [{ id: "canal-b1", provider: "whatsapp", name: "Atendimento B", phone: null }],
};

/** O conector gravado fica no teste: o `GET` devolve o último `PUT`, e cada `PUT` fica guardado. */
async function fakeConnector(page: Page, initial: Connector): Promise<Connector[]> {
  let saved: Connector = initial;
  const puts: Connector[] = [];
  await page.route("**/api/v1/settings/whatsapp.connector", async (route) => {
    if (route.request().method() === "PUT") {
      const { token: _token, ...value } = (route.request().postDataJSON() as { value: Connector & { token?: string } }).value;
      saved = value;
      puts.push(value);
    }
    await route.fulfill({ json: { ok: true, data: { key: "whatsapp.connector", value: saved } } });
  });
  await page.route("**/api/v1/whatsapp/crm-check", (route) => route.fulfill({ json: { ok: true, data: { mcp: "ok", rest: "ok", channels: CHANNELS[saved.crmUrl] ?? [] } } }));
  return puts;
}

test("outro CRM gravado: a conferência e o canal do CRM anterior saem da tela, e o canal do antigo não vai para o novo", async ({ page }) => {
  await signIn(page);
  const puts = await fakeConnector(page, { type: "deskcomm", url: CRM_A, crmUrl: CRM_A, channelSessionId: "canal-a2", channelLabel: "Vendas A" });
  await page.goto("/settings/whatsapp#avancado");
  // O `Field` envolve o controle no rótulo: o nome inclui a dica e as opções, então sem `exact`.
  const channel = page.getByLabel(settings.crmChannel);

  // No CRM A: confere e vê a lista dele, com o canal gravado escolhido.
  await page.getByRole("button", { name: settings.crmCheck, exact: true }).click();
  await expect(channel).toHaveValue("canal-a2");

  // Grava o conector com o CRM B: a tela já não manda o canal do A, e o bloco recomeça.
  await page.getByLabel(settings.crmUrl).fill(CRM_B);
  await page.getByLabel(settings.token).and(page.locator('input[type="password"]')).fill("token-do-crm-b");
  await page.getByRole("button", { name: settings.saveConnector, exact: true }).click();
  await expect.poll(() => puts.at(-1)?.crmUrl).toBe(CRM_B);
  expect(puts.at(-1)?.channelSessionId).toBeUndefined();
  await expect(page.getByText(settings.crmChannelRule, { exact: true })).toBeVisible();
  await expect(channel).toHaveCount(0);

  // No CRM B: a lista é a dele, nada vem escolhido, e salvar não grava canal nenhum.
  await page.getByRole("button", { name: settings.crmCheck, exact: true }).click();
  await expect(channel).toHaveValue("");
  await expect(channel.locator("option")).toHaveText([settings.crmChannelAny, "Atendimento B"]);
  const before = puts.length;
  await page.getByRole("button", { name: settings.crmChannelSave, exact: true }).click();
  await expect.poll(() => puts.length).toBe(before + 1);
  expect(puts.at(-1)).toEqual({ type: "deskcomm", url: CRM_B, crmUrl: CRM_B });
});
