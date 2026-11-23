// O clique no "Ouvir" do campo Voz (DESA-397, fatia 1b, ressalva do #559): quando o navegador recusa
// o `play()`, e quando o `<audio>` dá `error` (arquivo que não existe), a tela diz "A amostra não
// tocou". O `sample` é de fixture, posto na resposta de `/api/v1/engines`: nenhum MP3 real entra no
// repositório, e o arquivo que ele aponta não existe.
import { expect, test, type Page } from "@playwright/test";
import { fill } from "../../src/i18n/locales";
import agents from "../../src/i18n/pt-BR/agents";
import { signIn, unique } from "./session";

const SAMPLE = "voice-samples/e2e-fixture/sem-arquivo.pt-BR.mp3";

/** O agente no Gemini Live, com a voz padrão do motor ganhando um `sample` de fixture. Devolve a voz. */
async function openAgentWithFixtureSample(page: Page): Promise<string> {
  let voice = "";
  await page.route("**/api/v1/engines", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as { data: { id: string; defaultVoice?: string; voices?: { id: string; sample?: unknown }[] }[] };
    for (const engine of body.data) {
      if (engine.id !== "gemini-live") continue;
      voice = engine.defaultVoice ?? "";
      engine.voices = (engine.voices ?? []).map((v) => (v.id === voice ? { ...v, sample: { "pt-BR": SAMPLE } } : v));
    }
    await route.fulfill({ response, json: body });
  });
  await signIn(page);
  const created = await page.request.post("/api/v1/agents", { data: { name: `Amostra ${unique()}`, engine: "gemini-live" } });
  expect(created.status()).toBe(200);
  const agentId = ((await created.json()) as { data: { id: string } }).data.id;
  await page.goto(`/agents/${agentId}`);
  await expect(page.locator("option", { hasText: /^Zephyr\b/ })).toHaveCount(1);
  expect(voice).not.toBe("");
  return voice;
}

test("Ouvir: o navegador recusa o play() e a tela diz que a amostra não tocou", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("recusado pelo teste", "NotAllowedError"));
  });
  const voice = await openAgentWithFixtureSample(page);
  const listen = page.getByRole("button", { name: fill(agents.voiceListenLabel, { voice }) });
  await expect(listen).toBeEnabled();
  await expect(page.getByRole("alert").filter({ hasText: agents.voiceSampleFailed })).toHaveCount(0);
  await listen.click();
  await expect(page.getByRole("alert").filter({ hasText: agents.voiceSampleFailed })).toBeVisible();
});

test("Ouvir: o arquivo da amostra não carrega, o <audio> dá error e a tela diz que a amostra não tocou", async ({ page }) => {
  // O play() aceita e só pede o arquivo: o que diz "não tocou" aqui é o `error` do <audio>.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      this.load();
      return Promise.resolve();
    };
  });
  const asked: string[] = [];
  await page.route(`**/${SAMPLE}`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 404, body: "" });
  });
  const voice = await openAgentWithFixtureSample(page);
  const listen = page.getByRole("button", { name: fill(agents.voiceListenLabel, { voice }) });
  await expect(listen).toBeEnabled();
  // Nada é baixado antes do clique (`preload="none"`).
  expect(asked).toEqual([]);
  await listen.click();
  await expect(page.getByRole("alert").filter({ hasText: agents.voiceSampleFailed })).toBeVisible();
  expect(asked.length).toBeGreaterThan(0);
});
