import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import timeline from "../../src/i18n/pt-BR/timeline";
import { signIn, unique } from "./session";

// A nota que o roteiro da simulada guarda quando o agente tem a ferramenta (apps/voice/src/demo-script.ts).
const SCRIPTED_NOTE = "Prefere ser atendida às sextas de manhã.";
const phone = (): string => `(31) 9${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;

test("o agente com a nota marcada anota numa simulada, e a ligação seguinte do número mostra a nota marcada como simulada, com o link da primeira", async ({ page }) => {
  await signIn(page);
  const created = await page.request.post("/api/v1/agents", { data: { name: `Notas ${unique()}`, engine: "simulated" } });
  expect(created.status()).toBe(200);
  const agentId = ((await created.json()) as { data: { id: string } }).data.id;

  // 1. A ferramenta vem desligada e se liga na tela do agente.
  await page.goto(`/agents/${agentId}`);
  const tool = page.getByRole("checkbox", { name: /remember_caller_note/ });
  await expect(tool).not.toBeChecked();
  await tool.check();
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(common.actions.saved);

  // 2. Uma simulada com o número de um cliente, em que o agente anota.
  const from = phone();
  const simulate = async (): Promise<string> => {
    const response = await page.request.post("/api/v1/calls/simulate", { data: { agentId, from } });
    expect(response.status()).toBe(200);
    return ((await response.json()) as { data: { callId: string } }).data.callId;
  };
  const first = await simulate();
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/calls/${first}/caller-history`);
      return ((await response.json()) as { data: { noteCount: number } }).data.noteCount;
    }, { timeout: 45_000 })
    .toBe(1);

  // 3. A segunda chamada do número mostra a nota, marcada como simulada, com o link da primeira.
  const second = await simulate();
  await page.goto(`/calls/${second}`);
  const block = page.getByRole("region", { name: timeline.callerHistory.title });
  // A segunda também anota (o mesmo roteiro): o bloco lista as notas do número, inclusive a dela.
  await expect(block.getByRole("heading", { name: new RegExp(`^${timeline.callerHistory.notes.split(" (")[0]}`) })).toBeVisible();
  const origin = page.locator(`a[href="/calls/${first}"]`, { hasText: timeline.callerHistory.origin });
  const note = block.getByRole("listitem").filter({ hasText: SCRIPTED_NOTE }).filter({ has: origin });
  await expect(note).toBeVisible();
  await expect(note.getByText(common.channel.simulated, { exact: true })).toBeVisible();
});
