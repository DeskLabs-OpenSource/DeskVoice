import { expect, test, type Page } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import { signIn, unique } from "./session";

// "Pode passar a ligação para" na tela do agente (fatia 4b do desenho de 13/11, seção 4.2).

const createAgent = async (page: Page, data: Record<string, unknown>): Promise<string> => {
  const created = await page.request.post("/api/v1/agents", { data: { engine: "simulated", ...data } });
  expect(created.status()).toBe(200);
  return ((await created.json()) as { data: { id: string } }).data.id;
};

const save = async (page: Page) => {
  const patch = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/v1\/agents\/[^/]+$/.test(request.url()));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: common.actions.saved })).toHaveText(common.actions.saved);
  return (await patch).postDataJSON() as { agentHandoffTargets?: string[] };
};

const targetsOf = async (page: Page, id: string): Promise<string[]> =>
  ((await (await page.request.get(`/api/v1/agents/${id}`)).json()) as { data: { agentHandoffTargets: string[] } }).data.agentHandoffTargets;

test("passagem: a dona marca Vendas na Recepção, grava, e apagar Vendas deixa a Recepção editável e sem destino", async ({ page }) => {
  await signIn(page);
  const suffix = unique();
  const recepcao = `Recepção ${suffix}`;
  const vendas = `Vendas ${suffix}`;
  const recepcaoId = await createAgent(page, { name: recepcao });
  const vendasId = await createAgent(page, { name: vendas, roleLabel: `Comercial ${suffix}` });

  await page.goto(`/agents/${recepcaoId}`);
  const list = page.getByRole("list", { name: agents.handoff });
  const target = list.getByRole("checkbox", { name: new RegExp(vendas) });
  // Vazia de fábrica, com nome e papel; o próprio agente não aparece.
  await expect(target).not.toBeChecked();
  await expect(list.getByText(`Comercial ${suffix}`)).toBeVisible();
  await expect(list.getByRole("checkbox", { name: new RegExp(recepcao) })).toHaveCount(0);
  for (const line of [agents.handoffWhen, agents.handoffLimits, agents.handoffMax]) await expect(page.getByText(line)).toBeVisible();

  // Salvar sem marcar não muda nada.
  expect((await save(page)).agentHandoffTargets).toEqual([]);
  await target.check();
  expect((await save(page)).agentHandoffTargets).toEqual([vendasId]);
  await page.reload();
  await expect(page.getByRole("list", { name: agents.handoff }).getByRole("checkbox", { name: new RegExp(vendas) })).toBeChecked();
  expect(await targetsOf(page, recepcaoId)).toEqual([vendasId]);

  // Apaga Vendas pela tela dela.
  await page.goto(`/agents/${vendasId}`);
  await page.getByRole("button", { name: agents.delete }).click();
  // A confirmação diz o que vai junto: Vendas sai da lista da Recepção.
  await expect(page.getByText(`${vendas} também sai de "Pode passar a ligação para" em: ${recepcao}.`)).toBeVisible();
  await page.getByRole("button", { name: `Apagar ${vendas}` }).click();
  await expect(page).toHaveURL(/\/agents$/);

  // A Recepção fica sem destino, e editar o nome continua funcionando.
  await page.goto(`/agents/${recepcaoId}`);
  await expect(page.getByRole("list", { name: agents.handoff }).getByRole("checkbox", { name: new RegExp(vendas) })).toHaveCount(0);
  await page.getByRole("textbox", { name: agents.name, exact: true }).fill(`${recepcao} editada`);
  expect((await save(page)).agentHandoffTargets).toEqual([]);
  expect(await targetsOf(page, recepcaoId)).toEqual([]);
});
