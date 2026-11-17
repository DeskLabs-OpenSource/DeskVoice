import { expect, test } from "@playwright/test";
import calls from "../../src/i18n/pt-BR/calls";
import timeline from "../../src/i18n/pt-BR/timeline";
import { signIn } from "./session";

test("primeira ação útil: simular uma chamada abre a chamada com a linha do tempo andando", async ({ page }) => {
  await signIn(page);
  await page.goto("/calls");
  await expect(page.getByRole("heading", { level: 1, name: calls.title })).toBeVisible();

  // Sem chave nem tronco: o motor simulado atende. O botão existe com e sem chamadas na lista.
  await page.getByRole("button", { name: calls.simulate, exact: true }).click();
  await expect(page).toHaveURL(/\/calls\/[0-9a-f-]{36}$/);

  // A linha do tempo mostra a chegada, o atendimento e, ao vivo, o agente pedindo aprovação no meio
  // da conversa: a tela acompanha a chamada, e não só um retrato tirado ao abrir.
  await expect(page.getByText(timeline.events.call_started_simulated, { exact: true })).toBeVisible();
  await expect(page.getByText(timeline.events.call_answered, { exact: true })).toBeVisible();
  await expect(page.getByText(timeline.events.approval_requested, { exact: true })).toBeVisible({ timeout: 45_000 });
});
