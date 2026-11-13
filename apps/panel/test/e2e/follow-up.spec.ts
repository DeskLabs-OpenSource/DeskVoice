import { expect, test } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import followUps from "../../src/i18n/pt-BR/follow-ups";
import timeline from "../../src/i18n/pt-BR/timeline";
import { signIn, unique } from "./session";

// O título que o roteiro da chamada simulada manda para create_task (apps/voice/src/demo-script.ts).
const SCRIPTED_TITLE = "Confirmar com Marina Duarte o novo horário da limpeza de pele";

test("a pendência da ligação chega em Minhas, é fechada com uma nota e o fecho aparece na tela da chamada", async ({ page }) => {
  await signIn(page);
  const me = (await (await page.request.get("/api/v1/auth/me")).json()) as { data: { name: string } };
  const created = await page.request.post("/api/v1/agents", { data: { name: `Pendências ${unique()}`, engine: "simulated" } });
  expect(created.status()).toBe(200);
  const agentId = ((await created.json()) as { data: { id: string } }).data.id;

  // O dono das pendências se escolhe na tela do agente; o modelo nunca escolhe a pessoa.
  await page.goto(`/agents/${agentId}`);
  await page.getByLabel(agents.followUpOwner).selectOption({ label: me.data.name });
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(common.actions.saved);

  const simulated = await page.request.post("/api/v1/calls/simulate", { data: { agentId } });
  expect(simulated.status()).toBe(200);
  const callId = ((await simulated.json()) as { data: { callId: string } }).data.callId;

  await page.goto("/follow-ups");
  await page.getByRole("button", { name: followUps.views.mine, exact: true }).click();
  // Cada teste cria o que usa: a pendência é a desta ligação, achada pelo link dela.
  const item = page.getByRole("listitem").filter({ has: page.locator(`a[href="/calls/${callId}"]`) });
  await expect(item.getByRole("heading", { name: SCRIPTED_TITLE })).toBeVisible({ timeout: 45_000 });

  const note = `Retornei, horário confirmado (${unique()}).`;
  await item.getByRole("button", { name: followUps.done, exact: true }).click();
  await item.getByLabel(followUps.noteDone).fill(note);
  await item.getByRole("button", { name: followUps.confirmDone, exact: true }).click();
  await expect(item).toHaveCount(0);

  await page.goto(`/calls/${callId}`);
  await expect(page.getByText(timeline.events.follow_up_created, { exact: true })).toBeVisible();
  await expect(page.getByText(timeline.events.follow_up_closed.done, { exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
});
