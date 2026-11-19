import { expect, test, type Page } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import { signIn, unique } from "./session";

// "Quando a ligação cai", a opção "Ligar de volta" (desenho 2026-11-16-follow-up-da-ligacao-que-caiu,
// seções 3.6 e 3.8, fatia 4): com as ligações de saída desligadas, ela aparece desabilitada e diz por quê,
// com o caminho; com elas ligadas, o operador escolhe e a escolha é gravada.

type Policy = { enabled: boolean; purpose: string | null; legalBasis: string | null };
const readPolicy = async (page: Page): Promise<Policy> => ((await (await page.request.get("/api/v1/outbound-policy")).json()) as { data: Policy }).data;
const putPolicy = async (page: Page, body: Partial<Policy>) => expect((await page.request.put("/api/v1/outbound-policy", { data: body })).status()).toBe(200);

const save = async (page: Page) => {
  const patch = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/v1\/agents\/[^/]+$/.test(request.url()));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: common.actions.saved })).toHaveText(common.actions.saved);
  return (await patch).postDataJSON() as { dropFollowUp?: string };
};

test("Ligar de volta: desabilitada com o motivo e o link sem as ligações de saída, e escolhida e gravada com elas", async ({ page }) => {
  await signIn(page);
  const before = await readPolicy(page);
  await putPolicy(page, { enabled: false });
  try {
    const created = await page.request.post("/api/v1/agents", { data: { name: `Religação ${unique()}`, engine: "simulated" } });
    const agentId = ((await created.json()) as { data: { id: string } }).data.id;

    await page.goto(`/agents/${agentId}`);
    const field = page.getByRole("combobox", { name: agents.dropFollowUp });
    await expect(field).toHaveValue("off");
    const option = field.locator('option[value="call_back"]');
    await expect(option).toBeDisabled();
    await expect(option).toHaveText(`${agents.dropFollowUpCallBack} (${agents.dropFollowUpWhatsAppUnavailable})`);
    await expect(page.getByText(agents.dropFollowUpOutboundDisabled)).toBeVisible();
    await expect(page.getByRole("link", { name: agents.dropFollowUpOutboundLink })).toHaveAttribute("href", "/outbound");
    // O resto da tela continua salvando, e o modo que não mudou não vai no pedido.
    expect((await save(page)).dropFollowUp).toBeUndefined();

    // Com as ligações de saída ligadas, a opção vale e diz quantas tentativas, quando, e a lista de não ligar.
    await putPolicy(page, { enabled: true, purpose: before.purpose ?? "Retornar ligações que caíram (e2e)", legalBasis: before.legalBasis ?? "Legítimo interesse (e2e)" });
    await page.reload();
    await expect(page.getByText(agents.dropFollowUpOutboundDisabled)).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: agents.dropFollowUp }).locator('option[value="call_back"]')).toBeEnabled();
    await page.getByRole("combobox", { name: agents.dropFollowUp }).selectOption({ label: agents.dropFollowUpCallBack });
    await expect(page.getByText(agents.dropFollowUpCallBackHow)).toBeVisible();
    await expect(page.getByText(agents.dropFollowUpCallBackDoNotCall)).toBeVisible();
    expect(await save(page)).toMatchObject({ dropFollowUp: "call_back" });
    await page.reload();
    await expect(page.getByRole("combobox", { name: agents.dropFollowUp })).toHaveValue("call_back");
    const stored = ((await (await page.request.get(`/api/v1/agents/${agentId}`)).json()) as { data: { dropFollowUp: string } }).data;
    expect(stored.dropFollowUp).toBe("call_back");

    // As ligações de saída desligadas depois: a opção escolhida continua à vista, com o alerta e o caminho.
    await putPolicy(page, { enabled: false });
    await page.reload();
    await expect(page.getByRole("combobox", { name: agents.dropFollowUp })).toHaveValue("call_back");
    await expect(page.getByRole("alert").filter({ hasText: agents.dropFollowUpOutboundDisabled })).toBeVisible();
  } finally {
    await putPolicy(page, { enabled: before.enabled, purpose: before.purpose, legalBasis: before.legalBasis });
  }
});
