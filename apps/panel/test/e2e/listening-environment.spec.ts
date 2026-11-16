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
  const field = page.getByRole("combobox", { name: agents.listeningEnvironment });
  await expect(field).toHaveValue("normal");
  await expect(field.locator("option:checked")).toHaveText(agents.listeningEnvironmentNormal);

  // Salvar sem mexer no campo não muda o valor.
  expect((await save(page)).listeningEnvironment).toBe("normal");
  await page.reload();
  await expect(page.getByRole("combobox", { name: agents.listeningEnvironment })).toHaveValue("normal");

  await page.getByRole("combobox", { name: agents.listeningEnvironment }).selectOption({ label: agents.listeningEnvironmentNoisy });
  expect((await save(page)).listeningEnvironment).toBe("noisy");

  await page.reload();
  await expect(page.getByRole("combobox", { name: agents.listeningEnvironment })).toHaveValue("noisy");
  const stored = (await (await page.request.get(`/api/v1/agents/${agentId}`)).json()) as { data: { listeningEnvironment: string } };
  expect(stored.data.listeningEnvironment).toBe("noisy");
});

test("ambiente: fora do OpenAI a opção some, e um agente em Barulhento que troca para o Gemini vê o aviso e volta para Normal", async ({ page }) => {
  await signIn(page);

  // Motor sem prova e em Normal: o campo não aparece, mas a linha que conta que o modo existe fica.
  const simulatedId = await createAgent(page, { engine: "simulated" });
  await page.goto(`/agents/${simulatedId}`);
  // A nota do motor simulado só aparece depois que a tela carregou o motor do agente.
  await expect(page.getByText(agents.engineSimulated)).toBeVisible();
  await expect(page.getByRole("combobox", { name: agents.listeningEnvironment })).toHaveCount(0);
  await expect(page.getByText(agents.listeningEnvironmentOnlyOpenAi)).toBeVisible();
  await expect(page.getByText(agents.listeningEnvironmentHint)).toHaveCount(0);

  const agentId = await createAgent(page, { engine: "openai-realtime", listeningEnvironment: "noisy" });
  await page.goto(`/agents/${agentId}`);
  const field = page.getByRole("combobox", { name: agents.listeningEnvironment });
  await expect(field).toHaveValue("noisy");
  // No OpenAI a ajuda é a do campo, uma vez só: a linha de fora não se repete aqui.
  await expect(page.getByText(agents.listeningEnvironmentHint)).toHaveCount(1);
  await expect(page.getByText(agents.listeningEnvironmentOnlyOpenAi)).toHaveCount(0);
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
  await expect(page.getByRole("combobox", { name: agents.listeningEnvironment })).toHaveCount(0);
});

test("ambiente: voltar para Normal avisa que é só rascunho, e salvar tira o aviso", async ({ page }) => {
  await signIn(page);
  const agentId = await createAgent(page, { engine: "openai-realtime", listeningEnvironment: "noisy" });
  await page.goto(`/agents/${agentId}`);

  // Em Barulhento gravado, nada de aviso de rascunho.
  await expect(page.getByRole("combobox", { name: agents.listeningEnvironment })).toHaveValue("noisy");
  await expect(page.getByText(agents.listeningEnvironmentUnsaved)).toHaveCount(0);

  // Troca para o Gemini: o campo continua à vista por causa do gravado.
  await page.getByRole("combobox", { name: agents.engine, exact: true }).selectOption("gemini-live");
  await expect(page.locator("option", { hasText: /^Zephyr\b/ })).toHaveCount(1);
  const backToNormal = page.getByRole("button", { name: agents.listeningEnvironmentBackToNormal, exact: true });
  await expect(backToNormal).toBeVisible();

  // Voltar para Normal mexe só no rascunho: o campo some, e a tela diz que falta salvar.
  await backToNormal.click();
  await expect(page.getByRole("combobox", { name: agents.listeningEnvironment })).toHaveCount(0);
  await expect(page.getByText(agents.listeningEnvironmentOnlyOpenAi)).toBeVisible();
  await expect(page.getByText(agents.listeningEnvironmentUnsaved)).toBeVisible();

  // Quem recarrega sem salvar continua em Barulhento: o aviso é a única coisa que segura a pessoa.
  await page.reload();
  await expect(page.getByRole("combobox", { name: agents.listeningEnvironment })).toHaveValue("noisy");

  // Voltando de novo e salvando: o PATCH leva `normal`, o aviso sai e recarregada a tela não o traz.
  await page.getByRole("combobox", { name: agents.engine, exact: true }).selectOption("gemini-live");
  await expect(page.locator("option", { hasText: /^Zephyr\b/ })).toHaveCount(1);
  await page.getByRole("button", { name: agents.listeningEnvironmentBackToNormal, exact: true }).click();
  await expect(page.getByText(agents.listeningEnvironmentUnsaved)).toBeVisible();
  expect((await save(page)).listeningEnvironment).toBe("normal");
  await expect(page.getByText(agents.listeningEnvironmentUnsaved)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(agents.listeningEnvironmentUnsaved)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: agents.listeningEnvironment })).toHaveCount(0);
});
