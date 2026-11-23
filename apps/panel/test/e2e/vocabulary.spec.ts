import { expect, test, type Page } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import { signIn, unique } from "./session";

const createAgent = async (page: Page): Promise<string> => {
  const created = await page.request.post("/api/v1/agents", { data: { name: `Vocabulário ${unique()}`, engine: "simulated" } });
  expect(created.status()).toBe(200);
  return ((await created.json()) as { data: { id: string } }).data.id;
};

const stored = async (page: Page, agentId: string): Promise<string[]> =>
  ((await (await page.request.get(`/api/v1/agents/${agentId}`)).json()) as { data: { vocabulary: string[] } }).data.vocabulary;

test("vocabulário: o termo escrito na tela é salvo e volta depois de recarregar", async ({ page }) => {
  await signIn(page);
  const agentId = await createAgent(page);
  await page.goto(`/agents/${agentId}`);

  // O campo está à vista, com a frase que diz para que serve, e começa vazio.
  await expect(page.getByText(agents.vocabularyLead)).toBeVisible();
  const field = page.getByLabel(agents.vocabularyField);
  await expect(field).toHaveValue("");
  await expect(page.getByText("0 de 50")).toBeVisible();

  await field.fill("Melgaço\n  DeskVoice \n");
  await expect(page.getByText("2 de 50")).toBeVisible();
  const patch = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/v1\/agents\/[^/]+$/.test(request.url()));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: common.actions.saved })).toHaveText(common.actions.saved);
  expect(((await patch).postDataJSON() as { vocabulary: string[] }).vocabulary).toEqual(["Melgaço", "DeskVoice"]);

  await page.reload();
  await expect(page.getByLabel(agents.vocabularyField)).toHaveValue("Melgaço\nDeskVoice");
  expect(await stored(page, agentId)).toEqual(["Melgaço", "DeskVoice"]);

  // Apagar tudo volta para a lista vazia, igual a quem nunca preencheu.
  await page.getByLabel(agents.vocabularyField).fill("");
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: common.actions.saved })).toHaveText(common.actions.saved);
  expect(await stored(page, agentId)).toEqual([]);
});

test("vocabulário: termo inválido mostra o erro ao lado do campo e não salva", async ({ page }) => {
  await signIn(page);
  const agentId = await createAgent(page);
  await page.goto(`/agents/${agentId}`);
  const field = page.getByLabel(agents.vocabularyField);
  await expect(field).toHaveValue("");

  let patches = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && /\/api\/v1\/agents\/[^/]+$/.test(request.url())) patches += 1;
  });

  await field.fill("Melgaço\nmelgaço");
  const repeated = 'A linha 2 repete "melgaço". Maiúscula e minúscula contam como o mesmo termo.';
  await expect(page.getByRole("alert").filter({ hasText: repeated })).toBeVisible();
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(field).toBeFocused();

  await field.fill("<b>Melgaço</b>");
  await expect(page.getByRole("alert").filter({ hasText: "A linha 1 tem < ou >" })).toBeVisible();
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(field).toBeFocused();

  await page.reload();
  await expect(page.getByLabel(agents.vocabularyField)).toHaveValue("");
  expect(patches).toBe(0);
  expect(await stored(page, agentId)).toEqual([]);
});
