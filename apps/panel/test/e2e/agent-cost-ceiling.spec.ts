import { expect, test } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import { signIn, unique } from "./session";

// Teto de custo zero é "sem teto" (#610, 3.5): a tela do agente diz isso embaixo do campo, avisa em
// destaque quando o valor digitado vai sem teto, e o salvar continua mandando zero, como antes.

test("teto de custo: zero diz que fica sem teto, e salvar zero continua valendo como sem teto", async ({ page }) => {
  await signIn(page);
  const created = await page.request.post("/api/v1/agents", { data: { name: `Teto zero ${unique()}`, engine: "simulated" } });
  expect(created.status()).toBe(200);
  const agentId = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/agents/${agentId}?aba=avancado`);
  const ceiling = page.getByRole("textbox", { name: agents.costCeiling });
  await expect(ceiling).toHaveValue("5.00");
  await expect(page.getByText(agents.costCeilingHint)).toBeVisible();
  await expect(page.getByText(agents.costCeilingNone)).toHaveCount(0);

  await ceiling.fill("0,004");
  await expect(page.getByText(agents.costCeilingNone)).toBeVisible();
  await ceiling.fill("0,01");
  await expect(page.getByText(agents.costCeilingNone)).toHaveCount(0);
  await ceiling.fill("0");
  await expect(page.getByText(agents.costCeilingNone)).toBeVisible();

  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/api/v1/agents/${agentId}`));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  expect((await saved).status()).toBe(200);
  const read = await page.request.get(`/api/v1/agents/${agentId}`);
  expect(((await read.json()) as { data: { costCeilingCents: number } }).data.costCeilingCents).toBe(0);

  await page.reload();
  await expect(page.getByRole("textbox", { name: agents.costCeiling })).toHaveValue("0.00");
  await expect(page.getByText(agents.costCeilingNone)).toBeVisible();
});
