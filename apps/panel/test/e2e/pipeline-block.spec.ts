// O bloco "Pipeline" da tela do agente no navegador (fatia 5b-2 do pipeline, ressalvas 1 e 2 da DESA-437):
// o Ouvir de uma voz da ElevenLabs diz o erro quando a amostra não toca, pelo endereço que falha e pelo
// navegador que recusa o `play()`, e salvar um agente pela tela nunca leva `pipeline` no PATCH.
//
// A instalação do CI não tem chave da ElevenLabs nem de cérebro: a lista de vozes, a de cérebros e a de
// modelos vêm interceptadas no navegador, no formato das rotas. O resto (a página, o salvar, o PATCH e a
// leitura do agente depois) é o da instalação de verdade.
import { expect, test, type Page, type Route } from "@playwright/test";
import agents from "../../src/i18n/pt-BR/agents";
import common from "../../src/i18n/pt-BR/common";
import { signIn, unique } from "./session";

const SAMPLE = "/e2e-amostra-da-voz-que-falha.mp3";
const VOICE = "Bia de teste";
const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

const answer = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });

/** A conta da ElevenLabs com uma voz e a amostra dela, e um cérebro que conversa com um modelo com preço. */
async function interceptPieces(page: Page): Promise<{ sampleRequests: () => number }> {
  let sampleRequests = 0;
  await page.route(/\/api\/v1\/synthesizers$/, (route) =>
    answer(route, [{ id: "elevenlabs", label: "ElevenLabs", provider: "elevenlabs", processingLocation: { kind: "undeclared" }, configured: true, consent: null }]),
  );
  await page.route(/\/api\/v1\/synthesizers\/elevenlabs\/voices$/, (route) =>
    answer(route, { configured: true, failure: null, voices: [{ id: "v-bia", name: VOICE, languages: ["pt-BR"], previewUrl: SAMPLE }] }),
  );
  await page.route(/\/api\/v1\/brains$/, (route) =>
    answer(route, [
      { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", chat: true, configured: true, keyCheck: { result: "accepted", status: 200, checkedAt: "2026-11-24T12:00:00.000Z" }, modelCount: 2, fetchedAt: null, agents: [] },
    ]),
  );
  const price = { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "teste", checkedOn: "2026-11-24" };
  await page.route(/\/api\/v1\/brains\/openai\/models$/, (route) =>
    answer(route, { fetchedAt: "2026-11-24T12:00:00.000Z", stale: false, models: [{ id: "modelo-a", label: "Modelo A", price }, { id: "modelo-b", label: "Modelo B", price }] }),
  );
  // A amostra: o fornecedor que não responde direito (404, sem áudio).
  await page.route(`**${SAMPLE}`, (route) => {
    sampleRequests += 1;
    return route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  });
  return { sampleRequests: () => sampleRequests };
}

const createAgent = async (page: Page, data: Record<string, unknown>): Promise<string> => {
  const created = await page.request.post("/api/v1/agents", { data: { name: `Pipeline ${unique()}`, ...data } });
  expect(created.status()).toBe(200);
  return ((await created.json()) as { data: { id: string } }).data.id;
};

const pipelineBlock = (page: Page) => page.locator("#pipeline");
const listen = (page: Page) => pipelineBlock(page).getByRole("button", { name: fill(agents.pipelineVoiceListen, { voice: VOICE }), exact: true });
const failure = (page: Page) => pipelineBlock(page).getByRole("alert").filter({ hasText: agents.pipelineVoiceSampleFailed });

test("pipeline: o Ouvir de uma amostra que falha diz o erro, e nada é baixado antes do clique", async ({ page }) => {
  await signIn(page);
  const pieces = await interceptPieces(page);
  const agentId = await createAgent(page, { engine: "gemini-live" });
  await page.goto(`/agents/${agentId}`);

  await expect(listen(page)).toBeVisible();
  // `preload="none"`: a página aberta não pediu a amostra.
  expect(pieces.sampleRequests()).toBe(0);
  await expect(failure(page)).toHaveCount(0);

  await listen(page).click();
  await expect(failure(page)).toBeVisible();
  expect(pieces.sampleRequests()).toBeGreaterThan(0);
});

test("pipeline: o navegador que recusa o play() faz o Ouvir dizer o erro", async ({ page }) => {
  // O `play()` recusado sem que o endereço falhe (o bloqueio de áudio do navegador): só a recusa do
  // `play()` avisa, porque nenhum `error` chega ao elemento.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("blocked by the test", "NotAllowedError"));
  });
  await signIn(page);
  const pieces = await interceptPieces(page);
  const agentId = await createAgent(page, { engine: "gemini-live" });
  await page.goto(`/agents/${agentId}`);

  await expect(listen(page)).toBeVisible();
  await expect(failure(page)).toHaveCount(0);
  await listen(page).click();
  await expect(failure(page)).toBeVisible();
  // Nada foi baixado: a recusa veio antes de qualquer pedido.
  expect(pieces.sampleRequests()).toBe(0);
});

test("pipeline: salvar um agente Gemini pela tela, mexendo no bloco, não leva `pipeline` no PATCH; o Pipeline não é escolhível", async ({ page }) => {
  await signIn(page);
  await interceptPieces(page);
  const agentId = await createAgent(page, { engine: "gemini-live" });
  await page.goto(`/agents/${agentId}`);

  // O campo Motor mostra o Pipeline, desligado.
  const engine = page.getByRole("combobox", { name: agents.engine, exact: true });
  await expect(engine).toHaveValue("gemini-live");
  await expect(engine.locator('option[value="pipeline"]')).toBeDisabled();

  // Mexe nas escolhas do bloco: elas ficam só na tela.
  const model = pipelineBlock(page).getByRole("combobox", { name: agents.pipelineModel });
  await expect(model).toHaveValue("modelo-a");
  await model.selectOption("modelo-b");
  await expect(model).toHaveValue("modelo-b");

  const patch = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/v1\/agents\/[^/]+$/.test(request.url()));
  await page.getByRole("button", { name: common.actions.save, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: common.actions.saved })).toHaveText(common.actions.saved);
  const body = (await patch).postDataJSON() as Record<string, unknown>;
  expect(body).toEqual(expect.objectContaining({ engine: "gemini-live" }));
  expect(Object.keys(body)).not.toContain("pipeline");

  // O agente continua no Gemini, sem pipeline.
  const stored = (await (await page.request.get(`/api/v1/agents/${agentId}`)).json()) as { data: { engine: string; pipeline: unknown } };
  expect([stored.data.engine, stored.data.pipeline]).toEqual(["gemini-live", null]);
});
