import { expect, test, type Page, type Request } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import line from "../../src/i18n/pt-BR/line";
import { signIn, unique } from "./session";

// R8, fatia 10: a API recusa com `trunk_overlap_unconfirmed` a linha cuja faixa cruza a de outra
// organização (o teste de banco `trunk-overlap.db.test.ts` prova a recusa de verdade, com duas
// organizações). Aqui a resposta é simulada na primeira ida, e o teste prova a TELA: a caixa aparece
// antes de salvar, Voltar não grava nem diz "Salvo.", e "Salvar mesmo assim" reenvia com a confirmação.

const label = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
const section = (page: Page, name: string) => page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) });

const OVERLAP = {
  ok: false,
  error: {
    code: "trunk_overlap_unconfirmed",
    message: "Another organization of this installation has a line in a range that overlaps this one. If you save, the lines recognized by IP of both stop receiving calls until one of them changes its address.",
  },
};

test("faixa que cruza a de outra organização: a tela pergunta antes de salvar, Voltar não grava, e Salvar mesmo assim grava", async ({ page }) => {
  const name = `Faixa ${unique()}`;
  const sent: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/trunks", async (route, request: Request) => {
    if (request.method() !== "POST") return route.continue();
    const body = request.postDataJSON() as Record<string, unknown>;
    sent.push(body);
    // Sem a confirmação, a API recusaria: a gravação nunca chega ao servidor.
    if (body.confirmOverlap !== true) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify(OVERLAP) });
    return route.continue();
  });

  await signIn(page);
  await page.goto("/line");
  const form = section(page, line.newLine);
  await form.getByLabel(label(line.name)).fill(name);
  await form.getByLabel(label(line.host)).fill("192.0.2.77");
  await form.getByLabel(label(line.authMode)).selectOption({ label: line.authIp });
  await form.getByRole("button", { name: line.saveLine }).click();

  // A caixa, com a frase fixa: nada de nome, endereço ou organização da outra linha.
  const warning = form.getByRole("alert");
  await expect(warning).toHaveText(line.overlapWarning);
  expect(sent).toHaveLength(1);
  expect(sent[0]).not.toHaveProperty("confirmOverlap");
  await expect(form.getByText(common.actions.saved, { exact: true })).toHaveCount(0);

  // Voltar: a caixa some, nada foi gravado, e a tela não diz "Salvo.".
  await form.getByRole("button", { name: line.overlapBack, exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(form.getByText(common.actions.saved, { exact: true })).toHaveCount(0);
  await expect(section(page, name)).toHaveCount(0);
  expect(sent).toHaveLength(1);

  // De novo, e agora Salvar mesmo assim: reenvia a mesma linha com a confirmação, e ela é gravada.
  await form.getByRole("button", { name: line.saveLine }).click();
  await expect(warning).toHaveText(line.overlapWarning);
  await form.getByRole("button", { name: line.overlapSave, exact: true }).click();
  await expect(section(page, name)).toBeVisible();
  expect(sent).toHaveLength(3);
  expect(sent[2]).toMatchObject({ name, host: "192.0.2.77", authMode: "ip", confirmOverlap: true });

  // Limpa: a linha não fica para os testes de tela seguintes.
  const listed = (await (await page.request.get("/api/v1/trunks")).json()) as { data: Array<{ id: string; name: string }> };
  const created = listed.data.find((trunk) => trunk.name === name);
  expect(created).toBeDefined();
  expect((await page.request.delete(`/api/v1/trunks/${created?.id}`)).ok()).toBe(true);
});
