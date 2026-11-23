import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import common from "../../src/i18n/pt-BR/common";
import ivr from "../../src/i18n/pt-BR/ivr";
import { signIn, unique } from "./session";

// O anúncio do menu por teclas, convertido no navegador (DESA-187, item 3 da DESA-180). Nunca se salva
// silêncio: o que o Chromium abre vira o WAV da linha com a duração certa, e o resto é recusado com a
// frase que diz o que tentar.
//
// Os arquivos de `fixtures/` são um tom sintético de 440 Hz, 1 s, mono, gerado aqui (sem direito
// autoral de ninguém):
//   ffmpeg -f lavfi -i "sine=frequency=440:duration=1:sample_rate=22050" -ac 1 -b:a 32k -map_metadata -1 -fflags +bitexact tom-1s.mp3
//   ffmpeg -f lavfi -i "sine=frequency=440:duration=1:sample_rate=22050" -ac 1 -c:a aac -b:a 32k -map_metadata -1 -fflags +bitexact -movflags +faststart tom-1s.m4a

/** Ao lado do spec, sem depender de ESM ou CommonJS. */
const fixture = (name: string): Promise<Buffer> => readFile(path.join(path.dirname(test.info().file), "fixtures", name));
const TOLERANCE_MS = 50;
/** O que o banco gravou em `prompt_audio_ms` para o tom de 1 s: 1000 ms ± 100 (o desenho da 1d). */
const STORED_TOLERANCE_MS = 100;
const MIN_MS = 200;

interface Menu {
  id: string;
  name: string;
  promptAudioMs: number | null;
}

const createMenu = async (page: Page): Promise<Menu> => {
  const name = `Anúncio ${unique()}`;
  const created = await page.request.post("/api/v1/ivr-menus", { data: { name, options: [{ digit: "1", label: "Recepção", action: "transfer", transferTo: "+5531988887777" }] } });
  expect(created.status()).toBe(200);
  return ((await created.json()) as { data: Menu }).data;
};

const menuOf = async (page: Page, id: string): Promise<Menu> => ((await (await page.request.get(`/api/v1/ivr-menus/${id}`)).json()) as { data: Menu }).data;

/** A linha do menu na tela de Linha telefônica. */
const rowOf = async (page: Page, menu: Menu): Promise<Locator> => {
  await page.goto("/line");
  const row = page.getByRole("listitem").filter({ has: page.getByText(menu.name, { exact: true }) });
  await expect(row).toHaveCount(1);
  return row;
};

const uploadsOf = (page: Page, menu: Menu): string[] => {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith(`/api/v1/ivr-menus/${menu.id}/audio`)) seen.push(request.url());
  });
  return seen;
};

/**
 * O conteúdo do que foi gravado, e não só "passou": o `prompt_audio_ms` que o banco guardou, o WAV
 * que o "Ouvir" devolve com a mesma duração, e o som dentro dele. O tom de 440 Hz cruza o zero
 * ~880 vezes por segundo; silêncio não cruza, e um sinal com a taxa errada cruza em outro ritmo.
 */
const expectToneOfOneSecond = async (page: Page, menu: Menu): Promise<void> => {
  const stored = (await menuOf(page, menu.id)).promptAudioMs;
  expect(stored, "prompt_audio_ms gravado").not.toBeNull();
  expect(Math.abs((stored ?? 0) - 1000), `prompt_audio_ms ${stored}`).toBeLessThanOrEqual(STORED_TOLERANCE_MS);
  const { ms, pcm } = await savedWav(page, menu);
  expect(ms).toBe(stored);
  expect(Math.abs(ms - 1000), `${ms} ms`).toBeLessThanOrEqual(TOLERANCE_MS);
  // Com histerese: o chiado perto do zero (o atraso do decodificador) não conta como cruzamento.
  let peak = 0;
  let crossings = 0;
  let side = 0;
  for (let i = 0; i < pcm.length / 2; i += 1) {
    const sample = pcm.readInt16LE(i * 2);
    peak = Math.max(peak, Math.abs(sample));
    const now = sample > 500 ? 1 : sample < -500 ? -1 : side;
    if (side !== 0 && now !== side) crossings += 1;
    side = now;
  }
  expect(peak, "o anúncio tem som").toBeGreaterThan(1000);
  const perSecond = (crossings * 1000) / ms;
  expect(Math.abs(perSecond - 880), `${Math.round(perSecond)} cruzamentos por segundo`).toBeLessThanOrEqual(80);
};

/** O WAV que o servidor devolve: PCM16 mono a 8 kHz, a duração dele em ms e as amostras. */
const savedWav = async (page: Page, menu: Menu): Promise<{ ms: number; pcm: Buffer }> => {
  const response = await page.request.get(`/api/v1/ivr-menus/${menu.id}/audio`);
  expect(response.status()).toBe(200);
  const wav = await response.body();
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  expect(wav.readUInt16LE(20), "PCM").toBe(1);
  expect(wav.readUInt16LE(22), "mono").toBe(1);
  expect(wav.readUInt32LE(24), "8 kHz").toBe(8000);
  expect(wav.readUInt16LE(34), "16 bits").toBe(16);
  const pcm = wav.subarray(44, 44 + wav.readUInt32LE(40));
  return { ms: Math.round((pcm.length / 2 / 8000) * 1000), pcm };
};

/** Um WAV PCM16 mono a 8 kHz com `ms` de silêncio: o navegador abre, mas é curto demais. */
const shortWav = (ms: number): Buffer => {
  const samples = (ms * 8000) / 1000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
};

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("anúncio em MP3: salvo como WAV PCM16 mono a 8 kHz, com 1 s gravado e o tom dentro", async ({ page }) => {
  const menu = await createMenu(page);
  const row = await rowOf(page, menu);
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/api/v1/ivr-menus/${menu.id}/audio`));
  await row.locator('input[type="file"]').setInputFiles({ name: "tom-1s.mp3", mimeType: "audio/mpeg", buffer: await fixture("tom-1s.mp3") });
  expect((await saved).status()).toBe(200);
  await expectToneOfOneSecond(page, menu);
  await expect(row.getByText(ivr.unreadable)).toHaveCount(0);
});

test("anúncio em M4A (AAC): convertido com 1 s, ou recusado com a frase; nunca silêncio", async ({ page }) => {
  const menu = await createMenu(page);
  const uploads = uploadsOf(page, menu);
  const row = await rowOf(page, menu);
  const saved = page
    .waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/api/v1/ivr-menus/${menu.id}/audio`))
    .then((response) => ({ kind: "saved" as const, status: response.status() }));
  const refused = row
    .getByText(ivr.unreadable)
    .waitFor()
    .then(() => ({ kind: "refused" as const, status: 0 }));
  await row.locator('input[type="file"]').setInputFiles({ name: "tom-1s.m4a", mimeType: "audio/mp4", buffer: await fixture("tom-1s.m4a") });
  const outcome = await Promise.race([saved, refused]);
  // A promessa que perdeu a corrida não pode virar rejeição sem tratamento quando o teste acabar.
  void saved.catch(() => undefined);
  void refused.catch(() => undefined);
  test.info().annotations.push({ type: "m4a", description: outcome.kind });
  if (outcome.kind === "saved") {
    expect(outcome.status).toBe(200);
    expect((await menuOf(page, menu.id)).promptAudioMs).toBeGreaterThanOrEqual(MIN_MS);
    await expectToneOfOneSecond(page, menu);
  } else {
    // Sem codec AAC: a frase na tela, nada subiu e nada foi gravado.
    await expect(row.getByText(ivr.unreadable)).toBeVisible();
    expect(uploads).toEqual([]);
    expect((await menuOf(page, menu.id)).promptAudioMs).toBeNull();
  }
});

test("arquivo que não é áudio, e áudio com menos de 0,2 s: recusados com a frase, e nada sobe", async ({ page }) => {
  const menu = await createMenu(page);
  const uploads = uploadsOf(page, menu);
  const row = await rowOf(page, menu);
  const input = row.locator('input[type="file"]');

  await input.setInputFiles({ name: "nota.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("isto não é áudio, é uma nota em texto") });
  await expect(row.getByText(ivr.unreadable)).toBeVisible();

  // O navegador abre este, mas ele tem 0,1 s: seria silêncio salvo como anúncio.
  await page.reload();
  const again = page.getByRole("listitem").filter({ has: page.getByText(menu.name, { exact: true }) });
  await again.locator('input[type="file"]').setInputFiles({ name: "curto.wav", mimeType: "audio/wav", buffer: shortWav(100) });
  await expect(again.getByText(ivr.unreadable)).toBeVisible();

  expect(uploads).toEqual([]);
  expect((await menuOf(page, menu.id)).promptAudioMs).toBeNull();
});

test("a rota recusa o anúncio com menos de 0,2 s (`ivr_prompt_too_short`): a tela mostra a frase dele, e não a genérica", async ({ page }) => {
  const menu = await createMenu(page);
  const row = await rowOf(page, menu);
  // A tela recusa antes de subir; para chegar à recusa da rota, o PUT sai da tela com o tom de 1 s e
  // chega ao servidor de verdade com um WAV de 0,1 s no lugar.
  await page.route(`**/api/v1/ivr-menus/${menu.id}/audio`, (route) =>
    route.request().method() === "PUT" ? route.continue({ postData: shortWav(100) }) : route.continue(),
  );
  const refused = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/api/v1/ivr-menus/${menu.id}/audio`));
  await row.locator('input[type="file"]').setInputFiles({ name: "tom-1s.mp3", mimeType: "audio/mpeg", buffer: await fixture("tom-1s.mp3") });
  const response = await refused;
  expect(response.status()).toBe(400);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe("ivr_prompt_too_short");
  await expect(row.getByText(common.errors.ivr_prompt_too_short)).toBeVisible();
  await expect(row.getByText(common.errors.fallback)).toHaveCount(0);
  expect((await menuOf(page, menu.id)).promptAudioMs).toBeNull();
});
