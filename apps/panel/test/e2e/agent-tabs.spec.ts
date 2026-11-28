import { expect, test, type Page } from "@playwright/test";
import agentTests from "../../src/i18n/pt-BR/agent-tests";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import { signIn, unique } from "./session";

// A tela do agente em abas (desenho docs/specs/2026-11-26-construtor-de-agentes-abas.md, fatia 1):
// um formulário só, a aba no endereço, o obrigatório em aba fechada e o endereço antigo dos testes.

const createAgent = async (page: Page, name: string): Promise<string> => {
  const created = await page.request.post("/api/v1/agents", { data: { name, engine: "simulated" } });
  expect(created.status()).toBe(200);
  return ((await created.json()) as { data: { id: string } }).data.id;
};

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test("abas: teclado, três abas mudadas e um salvar só, ?aba= ao recarregar", async ({ page }) => {
  await signIn(page);
  const name = `Abas ${unique()}`;
  const agentId = await createAgent(page, name);
  await page.goto(`/agents/${agentId}`);

  // Sem `aba`, abre Agente. A fatia 1 não tem Ligações.
  const list = page.getByRole("tablist", { name: `Configuração de ${name}` });
  await expect(list.getByRole("tab")).toHaveText([agents.tabs.agente, agents.tabs.ferramentas, agents.tabs.depois, agents.tabs.testes, agents.tabs.avancado]);
  await expect(tab(page, agents.tabs.agente)).toHaveAttribute("aria-selected", "true");

  // Só com o teclado: a seta troca de aba e leva o foco; End e Home vão às pontas; a seta dá a volta.
  await tab(page, agents.tabs.agente).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, agents.tabs.ferramentas)).toBeFocused();
  await expect(tab(page, agents.tabs.ferramentas)).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\?aba=ferramentas$/);
  await page.keyboard.press("End");
  await expect(tab(page, agents.tabs.avancado)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab(page, agents.tabs.agente)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, agents.tabs.avancado)).toHaveAttribute("aria-selected", "true");
  // Só a aba ativa entra no Tab: o próximo Tab sai da lista e vai para o painel da aba.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel", { name: agents.tabs.avancado })).toBeFocused();

  // Uma mudança em cada uma de três abas, e um salvar só leva as três.
  await tab(page, agents.tabs.agente).click();
  await page.getByRole("textbox", { name: agents.greeting }).fill("Olá, aqui é a recepção.");
  await tab(page, agents.tabs.ferramentas).click();
  await expect(page.getByRole("textbox", { name: agents.greeting })).toBeHidden();
  await page.getByRole("switch", { name: agents.transferReturns }).click();
  await tab(page, agents.tabs.avancado).click();
  await page.getByRole("spinbutton", { name: agents.maxMinutes }).fill("12");
  // Trocar de aba não perde nada.
  await tab(page, agents.tabs.agente).click();
  await expect(page.getByRole("textbox", { name: agents.greeting })).toHaveValue("Olá, aqui é a recepção.");
  const patch = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith(`/api/v1/agents/${agentId}`));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(common.actions.saved);
  const body = (await patch).postDataJSON() as { greeting: string; transferReturnsToAgent: boolean; maxCallSeconds: number };
  expect([body.greeting, body.transferReturnsToAgent, body.maxCallSeconds]).toEqual(["Olá, aqui é a recepção.", false, 720]);

  // O endereço guarda a aba: recarregar com ?aba=depois abre Depois da ligação.
  await page.goto(`/agents/${agentId}?aba=depois`);
  await expect(tab(page, agents.tabs.depois)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel(agents.followUpOwner)).toBeVisible();
  // Valor desconhecido abre Agente.
  await page.goto(`/agents/${agentId}?aba=nao-existe`);
  await expect(tab(page, agents.tabs.agente)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: agents.name, exact: true })).toBeVisible();
});

test("abas: o teto vazio em aba fechada abre Avançado, com o foco e a mensagem, e nada é enviado", async ({ page }) => {
  await signIn(page);
  const agentId = await createAgent(page, `Teto ${unique()}`);
  await page.goto(`/agents/${agentId}?aba=avancado`);
  // Avançado leva às configurações da organização que afetam o agente.
  await expect(page.getByRole("link", { name: agents.organizationPrivacy })).toHaveAttribute("href", "/settings/privacy");
  await expect(page.getByRole("link", { name: agents.organizationRecording })).toHaveAttribute("href", "/settings/privacy");
  await expect(page.getByRole("link", { name: agents.organizationWebhooks })).toHaveAttribute("href", "/settings/integrations");
  const ceiling = page.getByRole("textbox", { name: agents.costCeiling });
  await ceiling.fill("");
  await tab(page, agents.tabs.agente).click();
  await expect(ceiling).toBeHidden();

  let patches = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith(`/api/v1/agents/${agentId}`)) patches += 1;
  });
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(tab(page, agents.tabs.avancado)).toHaveAttribute("aria-selected", "true");
  await expect(ceiling).toBeVisible();
  await expect(ceiling).toBeFocused();
  expect(await ceiling.evaluate((field: HTMLInputElement) => field.validationMessage)).not.toBe("");
  expect(patches).toBe(0);
});

test("abas: o endereço antigo dos testes abre a aba Testes, sem o Salvar do agente, e avisa da mudança não salva", async ({ page }) => {
  await signIn(page);
  const name = `Testes ${unique()}`;
  const agentId = await createAgent(page, name);
  await page.goto(`/agents/${agentId}/tests`);
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}\\?aba=testes$`));
  await expect(tab(page, agents.tabs.testes)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: agentTests.tabTitle })).toBeVisible();
  // Dois "Salvar" na mesma tela confundiriam: o do agente some em Testes, e o Apagar junto.
  await expect(page.getByRole("button", { name: common.actions.save, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: agents.delete })).toHaveCount(0);
  await expect(page.getByText(agents.unsavedChanges)).toHaveCount(0);

  // Uma mudança não salva na aba Avançado: Testes diz que ela existe e leva de volta para lá.
  await tab(page, agents.tabs.avancado).click();
  await page.getByRole("spinbutton", { name: agents.maxMinutes }).fill("7");
  await tab(page, agents.tabs.testes).click();
  await expect(page.getByText(agents.unsavedChanges)).toBeVisible();
  await page.getByRole("button", { name: `Voltar para ${agents.tabs.avancado}` }).click();
  await expect(tab(page, agents.tabs.avancado)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("spinbutton", { name: agents.maxMinutes })).toHaveValue("7");
});
