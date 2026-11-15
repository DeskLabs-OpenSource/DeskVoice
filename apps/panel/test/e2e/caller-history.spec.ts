import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import timeline from "../../src/i18n/pt-BR/timeline";
import { signIn, unique } from "./session";

// Um número só deste teste, para não encontrar as ligações de outro.
const phone = (): string => `(31) 9${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;

test("a segunda ligação simulada do mesmo número mostra a primeira no bloco Este número", async ({ page }) => {
  await signIn(page);
  const created = await page.request.post("/api/v1/agents", { data: { name: `Memória ${unique()}`, engine: "simulated" } });
  expect(created.status()).toBe(200);
  const agentId = ((await created.json()) as { data: { id: string } }).data.id;
  const from = phone();

  const simulate = async (): Promise<string> => {
    const response = await page.request.post("/api/v1/calls/simulate", { data: { agentId, from } });
    expect(response.status()).toBe(200);
    return ((await response.json()) as { data: { callId: string } }).data.callId;
  };
  const first = await simulate();
  // A primeira não mostra ligação anterior nenhuma: ela é a primeira deste número.
  await page.goto(`/calls/${first}`);
  const block = page.getByRole("region", { name: timeline.callerHistory.title });
  await expect(block).toBeVisible();
  await expect(block.getByRole("heading", { name: new RegExp(`^${timeline.callerHistory.calls.split(" (")[0]}`) })).toHaveCount(0);

  // O roteiro da simulada abre uma pendência para quem ligou: espera ela existir na primeira.
  let pending = "";
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/follow-ups?callId=${first}`);
      const items = ((await response.json()) as { data: { items: { title: string; status: string }[] } }).data.items;
      pending = items.find((item) => item.status === "open")?.title ?? "";
      return pending;
    }, { timeout: 30_000 })
    .not.toBe("");

  const second = await simulate();
  await page.goto(`/calls/${second}`);
  await expect(block.getByRole("heading", { name: timeline.callerHistory.calls.replace("{count}", "1") })).toBeVisible();
  await expect(block.locator(`a[href="/calls/${first}"]`).filter({ hasNotText: timeline.callerHistory.origin })).toBeVisible();
  // A pendência aberta da primeira ligação aparece no bloco da segunda, com o link para a de origem.
  const origin = page.locator(`a[href="/calls/${first}"]`, { hasText: timeline.callerHistory.origin });
  await expect(block.getByRole("listitem").filter({ hasText: pending }).filter({ has: origin })).toBeVisible();

  // Chamada simulada sem número não mostra o bloco.
  const anonymous = await page.request.post("/api/v1/calls/simulate", { data: { agentId } });
  const anonymousId = ((await anonymous.json()) as { data: { callId: string } }).data.callId;
  await page.goto(`/calls/${anonymousId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: timeline.callerHistory.title })).toHaveCount(0);
});
