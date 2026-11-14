import { expect, test, type Page } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import { signIn, unique } from "./session";

const save = async (page: Page) => {
  const patch = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/v1\/agents\/[^/]+$/.test(request.url()));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  // O aviso de motor sem chave também é um "status": procura só o de salvo.
  await expect(page.getByRole("status").filter({ hasText: common.actions.saved })).toHaveText(common.actions.saved);
  return (await patch).postDataJSON() as { listeningEnvironment?: string };
};

const createAgent = async (page: Page, data: Record<string, unknown>): Promise<string> => {
  const created = await page.request.post("/api/v1/agents", { data: { name: `Ambiente ${unique()}`, ...data } });
  expect(created.status()).toBe(200);
  return ((await created.json()) as { data: { id: string } }).data.id;
};

test("ambiente: o agente sem escolha abre em Normal, salvar sem mexer mantém, e Barulhento persiste depois de recarregar", async ({ page }) => {
  await signIn(page);
  // Criado sem o campo, como um agente de antes da escolha existir na tela. Barulhento só aparece no OpenAI.
  const agentId = await createAgent(page, { engine: "openai-realtime" });

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

test("ambiente: fora do OpenAI a opção some, e um agente em Barulhento que troca para o Gemini vê o aviso e volta para Normal", async ({ page }) => {
  await signIn(page);

  // Motor sem prova e em Normal: o campo não aparece.
  const simulatedId = await createAgent(page, { engine: "simulated" });
  await page.goto(`/agents/${simulatedId}`);
  // A nota do motor simulado só aparece depois que a tela carregou o motor do agente.
  await expect(page.getByText(agents.engineSimulated)).toBeVisible();
  await expect(page.getByLabel(agents.listeningEnvironment)).toHaveCount(0);

  const agentId = await createAgent(page, { engine: "openai-realtime", listeningEnvironment: "noisy" });
  await page.goto(`/agents/${agentId}`);
  const field = page.getByLabel(agents.listeningEnvironment);
  await expect(field).toHaveValue("noisy");
  const warning = page.getByText(agents.listeningEnvironmentUnproven.slice(0, agents.listeningEnvironmentUnproven.indexOf("{engine}")));
  await expect(warning).toHaveCount(0);

  // Troca para o Gemini: o Barulhento não fica escondido; o campo segue à vista, com o aviso.
  await page.getByRole("combobox", { name: agents.engine, exact: true }).selectOption("gemini-live");
  // As vozes do Gemini na lista provam que a tela já está no motor do Gemini.
  const geminiVoice = page.locator("option", { hasText: /^Zephyr\b/ });
  await expect(geminiVoice).toHaveCount(1);
  await expect(field).toHaveValue("noisy");
  await expect(warning).toBeVisible();

  // Salvar assim não esconde nada: depois de recarregar, o aviso continua lá.
  expect((await save(page)).listeningEnvironment).toBe("noisy");
  await page.reload();
  await expect(geminiVoice).toHaveCount(1);
  await expect(warning).toBeVisible();

  // Voltar para Normal: o PATCH leva `normal` e, recarregada, a tela não mostra mais o campo.
  await page.getByRole("button", { name: agents.listeningEnvironmentBackToNormal, exact: true }).click();
  await expect(warning).toHaveCount(0);
  expect((await save(page)).listeningEnvironment).toBe("normal");
  await page.reload();
  await expect(geminiVoice).toHaveCount(1);
  await expect(page.getByLabel(agents.listeningEnvironment)).toHaveCount(0);
});
