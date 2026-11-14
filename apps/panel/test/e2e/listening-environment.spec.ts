import { expect, test, type Page } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import { signIn, unique } from "./session";

const save = async (page: Page) => {
  const patch = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/v1\/agents\/[^/]+$/.test(request.url()));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(common.actions.saved);
  return (await patch).postDataJSON() as { listeningEnvironment?: string };
};

test("ambiente: o agente sem escolha abre em Normal, salvar sem mexer mantém, e Barulhento persiste depois de recarregar", async ({ page }) => {
  await signIn(page);
  // Criado sem o campo, como um agente de antes da escolha existir na tela.
  const created = await page.request.post("/api/v1/agents", { data: { name: `Ambiente ${unique()}`, engine: "simulated" } });
  expect(created.status()).toBe(200);
  const agentId = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/agents/${agentId}`);
  const field = page.getByLabel(agents.listeningEnvironment);
  await expect(field).toHaveValue("normal");
  await expect(field.locator("option:checked")).toHaveText(agents.listeningEnvironmentNormal);

  // Salvar sem mexer no campo não muda o valor.
  expect((await save(page)).listeningEnvironment).toBe("normal");
  await page.reload();
  await expect(page.getByLabel(agents.listeningEnvironment)).toHaveValue("normal");

  await page.getByLabel(agents.listeningEnvironment).selectOption({ label: agents.listeningEnvironmentNoisy });
  expect((await save(page)).listeningEnvironment).toBe("noisy");

  await page.reload();
  await expect(page.getByLabel(agents.listeningEnvironment)).toHaveValue("noisy");
  const stored = (await (await page.request.get(`/api/v1/agents/${agentId}`)).json()) as { data: { listeningEnvironment: string } };
  expect(stored.data.listeningEnvironment).toBe("noisy");
});
