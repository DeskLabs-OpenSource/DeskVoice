import { expect, test, type Page } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import health from "../../src/i18n/pt-BR/health";
import { signIn } from "./session";

/** A linha da tela pelo nome exato da peça: "Painel" é parte de "Painel ↔ banco de dados". */
const lines = (page: Page) => page.getByRole("list", { name: health.title }).getByRole("listitem");
const line = (page: Page, id: keyof typeof health.lines) => lines(page).filter({ has: page.getByText(health.lines[id], { exact: true }) });
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// O resumo no menu, como ele pode estar: tudo bem, ou "Pedem atenção: N".
const summary = new RegExp(`^(${escape(common.health.allOk)}|${escape(common.health.attention).replace(escape("{n}"), "\\d+")})$`);

// Itens 8.4 e 11.6 da régua: a tela mostra cada peça e cada ligação, com rotinas e agente
// conferidos de dentro do painel. No CI, a instalação do runner tem o processo de rotinas de pé e
// o agente de atualização falou com o painel um passo antes destes testes.
test("saúde do sistema: cada peça e cada ligação aparecem, na ordem de depuração, numa instalação nova", async ({ page }) => {
  await signIn(page);
  await page.goto("/calls");
  // A porta: o resumo da saúde no menu leva à tela.
  await page.getByRole("link", { name: summary }).click();
  await expect(page).toHaveURL(/\/health$/);
  await expect(page.getByRole("heading", { level: 1, name: health.title })).toBeVisible();

  const order = Object.keys(health.lines) as Array<keyof typeof health.lines>;
  for (const id of order) await expect(line(page, id)).toHaveCount(1);
  await expect(lines(page)).toHaveText(order.map((id) => new RegExp(`^${escape(health.lines[id])}`)));

  // De dentro: o processo de rotinas escuta a fila, e o agente falou há pouco.
  await expect(line(page, "routines")).toContainText(health.reasons.routines_ok);
  await expect(line(page, "agent")).toContainText(health.status.ok);
  await expect(line(page, "telephony")).toContainText(health.reasons.telephony_ok);
  // Instalação nova: WhatsApp não instalado é o padrão; sem chave de motor, o motor pede atenção e diz o que fazer.
  await expect(line(page, "whatsapp")).toContainText(health.reasons.whatsapp_absent);
  await expect(line(page, "engine")).toContainText(health.reasons.engine_none);
  await expect(line(page, "engine")).toContainText(health.actions.engine_none);

  // Sem falha, o topo diz que o sistema está no ar e nomeia o que pede atenção.
  await expect(page.getByRole("status").filter({ hasText: health.lines.engine })).toBeVisible();
  await page.getByRole("button", { name: health.recheck, exact: true }).click();
  await expect(line(page, "routines")).toContainText(health.reasons.routines_ok);
});
