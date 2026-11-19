import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
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

/** O WAV que o servidor devolve: PCM16 mono a 8 kHz, e a duração dele em ms. */
const savedWav = async (page: Page, menu: Menu): Promise<number> => {
  const response = await page.request.get(`/api/v1/ivr-menus/${menu.id}/audio`);
  expect(response.status()).toBe(200);
  const wav = await response.body();
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  expect(wav.readUInt16LE(20), "PCM").toBe(1);
  expect(wav.readUInt16LE(22), "mono").toBe(1);
  expect(wav.readUInt32LE(24), "8 kHz").toBe(8000);
  expect(wav.readUInt16LE(34), "16 bits").toBe(16);
  return Math.round((wav.readUInt32LE(40) / 2 / 8000) * 1000);
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

test("anúncio em MP3: salvo como WAV PCM16 mono a 8 kHz, com 1 s", async ({ page }) => {
  const menu = await createMenu(page);
  const row = await rowOf(page, menu);
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/api/v1/ivr-menus/${menu.id}/audio`));
  await row.locator('input[type="file"]').setInputFiles({ name: "tom-1s.mp3", mimeType: "audio/mpeg", buffer: await fixture("tom-1s.mp3") });
  expect((await saved).status()).toBe(200);
  const ms = await savedWav(page, menu);
  expect(Math.abs(ms - 1000), `${ms} ms`).toBeLessThanOrEqual(TOLERANCE_MS);
  expect((await menuOf(page, menu.id)).promptAudioMs).toBe(ms);
  await expect(row.getByText(ivr.unreadable)).toHaveCount(0);
});

test("anúncio em M4A (AAC): convertido com 1 s, ou recusado com a frase; nunca silêncio", async ({ page }) => {
  const menu = await createMenu(page);
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
    const ms = await savedWav(page, menu);
    expect(ms).toBeGreaterThanOrEqual(MIN_MS);
    expect(Math.abs(ms - 1000), `${ms} ms`).toBeLessThanOrEqual(TOLERANCE_MS);
  } else {
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
