// A chave e as vozes da ElevenLabs pela tela (desenho R5, fatia 1b, com a seção 9.1): gravar a chave
// pede a confirmação nomeando o fornecedor (sem ela, 422 e nenhum recibo); cada confirmação nova grava
// o recibo `synthesizer_provider_confirmed` na mesma transação; apagar a chave apaga a confirmação e
// deixa o recibo; a chave nunca volta para a tela nem para o log; as vozes vêm com pt-BR primeiro.
import type * as core from "@deskvoice/core";
import { decryptSecret, withOrg } from "@deskvoice/core";
import { loadSynthesizers } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, SECRET_KEY, call, createOrganization, createUser, startPanel } from "../../../../../test/kit";
import voiceText from "../../../../i18n/pt-BR/voice";
import { listAllSynthesizers, synthesizerKeyCheckLimiter, synthesizerVoicesLimiter } from "../../../../server/synthesizers";
import { GET as getPrivacy } from "../privacy/route";
import { DELETE as removeMember } from "../team/users/[id]/route";
import { DELETE as removeKey, POST as retestKey, PUT as putKey } from "./[synthesizer]/key/route";
import { GET as getVoices } from "./[synthesizer]/voices/route";
import { GET as listAll } from "./route";

// O recibo pode falhar de propósito, para provar que ele está na mesma transação da chave.
const failReceipt = vi.hoisted(() => ({ on: false }));
vi.mock("@deskvoice/core", async (importOriginal) => {
  const original = await importOriginal<typeof core>();
  return {
    ...original,
    recordOrgEvent: (...args: Parameters<typeof original.recordOrgEvent>) =>
      failReceipt.on && args[1] === "synthesizer_provider_confirmed" ? Promise.reject(new Error("receipt failed on purpose")) : original.recordOrgEvent(...args),
  };
});

const panel = startPanel();
afterAll(() => panel.close());

// Chaves inventadas, longas o bastante para aparecer onde vazassem.
const KEY = "chave-de-voz-inventada-nao-real-0123456789";
const OTHER_KEY = "outra-chave-de-voz-inventada-nao-real-9876543210";

const VOICES = [
  { voice_id: "v-adam", name: "Adam", preview_url: "https://storage.example.test/adam.mp3", verified_languages: [{ language: "en", locale: "en-US" }] },
  { voice_id: "v-ze", name: "Zé", preview_url: "https://storage.example.test/ze.mp3", verified_languages: [{ language: "pt", locale: "pt-BR" }] },
  { voice_id: "v-joana", name: "Joana", preview_url: "https://storage.example.test/joana.mp3", verified_languages: [{ language: "pt", locale: "pt-PT" }] },
  { voice_id: "v-bia", name: "Bia", verified_languages: [{ language: "en", locale: "en-GB" }, { language: "pt", locale: "pt-BR" }] },
  { voice_id: "v-sem", name: "Sem idioma", preview_url: "http://inseguro.example.test/sem.mp3" },
];

let elevenlabs: { status: number; body: unknown };
const providerRequests: Array<{ url: string; key: string | null }> = [];
let written: string[] = [];

let org: string;
let otherOrg: string;
let owner: { id: string; cookie: string };
let admin: { id: string; cookie: string };
let operator: { id: string; cookie: string };
let otherOwner: string;

const receipts = (organizationId: string) =>
  withOrg(panel.app, organizationId, (q) =>
    q.many<{ kind: string; actor_user_id: string | null; payload: Record<string, unknown>; at: Date }>(
      "select kind, actor_user_id, payload, at from organization_events where kind = 'synthesizer_provider_confirmed' order by id",
    ),
  );
const settingsOf = (organizationId: string) =>
  withOrg(panel.app, organizationId, (q) => q.many<{ key: string; value: unknown; secret: boolean }>("select key, value, secret from settings where key like 'synthesizer.%' order by key"));
const save = (cookie: string, body: object) => call(putKey, { method: "PUT", cookie, params: { synthesizer: "elevenlabs" }, body });
const confirmed = { confirmedProvider: "elevenlabs" };

beforeAll(async () => {
  org = await createOrganization(panel.app, "voice-key");
  otherOrg = await createOrganization(panel.app, "voice-key-other");
  owner = await createUser(panel.app, org, "owner");
  admin = await createUser(panel.app, org, "admin");
  operator = await createUser(panel.app, org, "operator");
  otherOwner = (await createUser(panel.app, otherOrg, "owner")).cookie;
});

beforeEach(() => {
  panel.clock.at = NOW;
  synthesizerKeyCheckLimiter.clear();
  synthesizerVoicesLimiter.clear();
  providerRequests.length = 0;
  elevenlabs = { status: 200, body: null };
  panel.voice.respond = (url, init) => {
    providerRequests.push({ url, key: new Headers(init.headers).get("xi-api-key") });
    if (url.startsWith("https://api.elevenlabs.io/v2/voices")) {
      if (elevenlabs.status !== 200) return Response.json({ detail: "nope" }, { status: elevenlabs.status });
      const pageSize = new URL(url).searchParams.get("page_size");
      return Response.json({ voices: pageSize === "1" ? VOICES.slice(0, 1) : VOICES, has_more: false, next_page_token: null });
    }
    throw new Error("connect ECONNREFUSED");
  };
  // Tudo o que o processo escreve no log durante o teste: a chave não pode estar em nenhum.
  written = [];
  const capture = (chunk: unknown): boolean => {
    written.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stderr, "write").mockImplementation(capture);
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void written.push(args.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("a chave da voz, com a confirmação e o recibo", () => {
  it("a descoberta do painel acha as mesmas vozes que a da pasta, e a tela oferece só as que pedem chave", async () => {
    expect((await listAllSynthesizers()).map((each) => each.id).sort()).toEqual([...(await loadSynthesizers()).keys()].sort());
    const all = await call(listAll, { cookie: owner.cookie });
    expect(all.data).toEqual([
      {
        id: "elevenlabs",
        label: "ElevenLabs",
        provider: "elevenlabs",
        // Onde processa não tem fonte: o aviso diz "não declara".
        processingLocation: { kind: "undeclared" },
        keyUrl: "https://elevenlabs.io/app/settings/api-keys",
        configured: false,
        keyCheck: null,
        consent: null,
      },
    ]);
  });

  it("sem a confirmação, ou nomeando outro fornecedor: 422, nada gravado e nenhum recibo", async () => {
    for (const extra of [{}, { confirmedProvider: "openai" }]) {
      const refused = await save(owner.cookie, { apiKey: KEY, ...extra });
      expect(refused.status).toBe(422);
      expect(refused.text).not.toContain(KEY);
    }
    expect(await settingsOf(org)).toEqual([]);
    expect(await receipts(org)).toEqual([]);
    expect(providerRequests).toEqual([]);
  });

  it("se o recibo falha, a chave e a confirmação também não ficam: estão na mesma transação", async () => {
    failReceipt.on = true;
    try {
      expect((await save(owner.cookie, { apiKey: KEY, ...confirmed })).status).toBe(500);
    } finally {
      failReceipt.on = false;
    }
    expect(await settingsOf(org)).toEqual([]);
    expect(await receipts(org)).toEqual([]);
  });

  it("quem não configura não grava a chave", async () => {
    expect((await save(operator.cookie, { apiKey: KEY, ...confirmed })).status).toBe(403);
    expect(await settingsOf(org)).toEqual([]);
  });

  it("confirmar grava a chave cifrada, a confirmação e 1 recibo com o nome, sem e-mail; a chave testa e nunca volta", async () => {
    panel.clock.at = new Date("2026-03-01T16:30:00.000Z");
    const saved = await save(admin.cookie, { apiKey: KEY, ...confirmed });
    expect([saved.status, saved.data]).toEqual([200, { configured: true, check: { result: "accepted", model: "eleven_flash_v2_5", checkedAt: "2026-03-01T16:30:00.000Z" } }]);
    // A chave foi à ElevenLabs pelo cabeçalho, e só a ela, no teste que não gasta caractere.
    expect(providerRequests.map((request) => [request.url, request.key])).toEqual([["https://api.elevenlabs.io/v2/voices?page_size=1", KEY]]);

    const rows = await settingsOf(org);
    expect(rows.map((row) => [row.key, row.secret])).toEqual([
      ["synthesizer.elevenlabs.api_key", true],
      ["synthesizer.elevenlabs.consent", false],
      ["synthesizer.elevenlabs.key_check", false],
    ]);
    expect(JSON.stringify(rows)).not.toContain(KEY);
    expect(decryptSecret(rows[0]?.value as string, SECRET_KEY)).toBe(KEY);
    expect(rows[1]?.value).toEqual({ userId: admin.id, confirmedAt: "2026-03-01T16:30:00.000Z" });

    expect(await receipts(org)).toEqual([
      {
        kind: "synthesizer_provider_confirmed",
        actor_user_id: admin.id,
        at: panel.clock.at,
        payload: { synthesizerId: "elevenlabs", provider: "elevenlabs", confirmedByName: "Test admin" },
      },
    ]);
    expect(JSON.stringify(await receipts(org))).not.toMatch(/@|chave-de-voz/);

    const all = await call(listAll, { cookie: owner.cookie });
    expect(all.data).toEqual([
      expect.objectContaining({
        configured: true,
        keyCheck: { result: "accepted", model: "eleven_flash_v2_5", checkedAt: "2026-03-01T16:30:00.000Z" },
        consent: { name: "Test admin", at: "2026-03-01T16:30:00.000Z" },
      }),
    ]);
    for (const response of [saved, all]) expect(response.text).not.toContain(KEY);
    expect(written.join("\n")).not.toContain(KEY);
  });

  it("testar de novo a mesma chave, pelo botão ou colando-a de novo, não pede confirmação nem grava outro recibo", async () => {
    panel.clock.at = new Date("2026-03-02T09:00:00.000Z");
    const retested = await call(retestKey, { method: "POST", cookie: owner.cookie, params: { synthesizer: "elevenlabs" } });
    expect([retested.status, retested.data]).toEqual([200, { configured: true, check: { result: "accepted", model: "eleven_flash_v2_5", checkedAt: "2026-03-02T09:00:00.000Z" } }]);
    expect((await save(owner.cookie, { apiKey: KEY })).status).toBe(200);
    expect((await save(owner.cookie, { apiKey: KEY, ...confirmed })).status).toBe(200);
    expect(await receipts(org)).toHaveLength(1);
    // A confirmação vigente continua a primeira: quem e quando batem com o recibo.
    expect((await settingsOf(org)).find((row) => row.key === "synthesizer.elevenlabs.consent")?.value).toEqual({ userId: admin.id, confirmedAt: "2026-03-01T16:30:00.000Z" });
    expect(written.join("\n")).not.toContain(KEY);
  });

  it("uma chave nova pede confirmação nova; sem ela, 422 e a chave antiga fica", async () => {
    const refused = await save(owner.cookie, { apiKey: OTHER_KEY });
    expect([refused.status, refused.code]).toEqual([422, "provider_confirmation_required"]);
    const rows = await settingsOf(org);
    expect(decryptSecret(rows.find((row) => row.key === "synthesizer.elevenlabs.api_key")?.value as string, SECRET_KEY)).toBe(KEY);
    expect(await receipts(org)).toHaveLength(1);

    panel.clock.at = new Date("2026-03-03T10:00:00.000Z");
    expect((await save(owner.cookie, { apiKey: OTHER_KEY, ...confirmed })).status).toBe(200);
    expect((await receipts(org)).map((receipt) => [receipt.actor_user_id, receipt.payload.confirmedByName])).toEqual([
      [admin.id, "Test admin"],
      [owner.id, "Test owner"],
    ]);
  });

  it("as vozes vêm da conta, pt-BR primeiro, só com amostra https, e nada é guardado", async () => {
    const before = await settingsOf(org);
    const voices = await call(getVoices, { cookie: owner.cookie, params: { synthesizer: "elevenlabs" } });
    expect(voices.status).toBe(200);
    expect(voices.data).toEqual({
      configured: true,
      failure: null,
      voices: [
        { id: "v-bia", name: "Bia", languages: ["en-GB", "pt-BR"] },
        { id: "v-ze", name: "Zé", languages: ["pt-BR"], previewUrl: "https://storage.example.test/ze.mp3" },
        { id: "v-joana", name: "Joana", languages: ["pt-PT"], previewUrl: "https://storage.example.test/joana.mp3" },
        { id: "v-adam", name: "Adam", languages: ["en-US"], previewUrl: "https://storage.example.test/adam.mp3" },
        // Amostra fora de https não vai para a tela.
        { id: "v-sem", name: "Sem idioma", languages: [] },
      ],
    });
    expect(providerRequests.map((request) => [request.url, request.key])).toEqual([["https://api.elevenlabs.io/v2/voices?page_size=100", OTHER_KEY]]);
    // Sem lista nem áudio no banco: a leitura não muda a `settings`.
    expect(await settingsOf(org)).toEqual(before);
    expect(voices.text).not.toContain(OTHER_KEY);
  });

  it("a falha ao ler as vozes volta no vocabulário fechado, sem o texto do fornecedor", async () => {
    elevenlabs = { status: 401, body: null };
    const voices = await call(getVoices, { cookie: owner.cookie, params: { synthesizer: "elevenlabs" } });
    expect(voices.data).toEqual({ configured: true, voices: [], failure: { result: "rejected", status: 401 } });
    expect(voices.text).not.toContain("nope");
  });

  it("o 502 da ElevenLabs no /v2/voices é erro do fornecedor (provider_error), e a tela não manda conferir a internet", async () => {
    // O caso de 18/11: o fornecedor respondeu 502 com página de proxy, e a tela dizia que ele não foi alcançado.
    panel.clock.at = new Date("2026-03-04T08:00:00.000Z");
    elevenlabs = { status: 502, body: null };
    const retested = await call(retestKey, { method: "POST", cookie: owner.cookie, params: { synthesizer: "elevenlabs" } });
    expect([retested.status, retested.data]).toEqual([200, { configured: true, check: { result: "provider_error", model: "eleven_flash_v2_5", checkedAt: "2026-03-04T08:00:00.000Z" } }]);
    expect((await settingsOf(org)).find((row) => row.key === "synthesizer.elevenlabs.key_check")?.value).toEqual({ result: "provider_error", model: "eleven_flash_v2_5", checkedAt: "2026-03-04T08:00:00.000Z" });
    const all = await call(listAll, { cookie: owner.cookie });
    const keyCheck = (all.data as Array<{ keyCheck: { result: keyof typeof voiceText.results } | null }>)[0]?.keyCheck;
    expect(keyCheck?.result).toBe("provider_error");
    // A frase que o cartão da voz escreve para esse resultado (`t.results[check.result]`).
    expect(voiceText.results[keyCheck?.result ?? "unreachable"]).toBe("o fornecedor respondeu com erro do lado dele. Costuma passar sozinho: tente de novo em alguns minutos.");

    const voices = await call(getVoices, { cookie: owner.cookie, params: { synthesizer: "elevenlabs" } });
    expect(voices.data).toEqual({ configured: true, voices: [], failure: { result: "provider_error", status: 502 } });
  });

  it("apagar a chave apaga a confirmação e o teste, e deixa os recibos", async () => {
    const removed = await call(removeKey, { method: "DELETE", cookie: owner.cookie, params: { synthesizer: "elevenlabs" } });
    expect([removed.status, removed.data]).toEqual([200, { configured: false }]);
    expect(await settingsOf(org)).toEqual([]);
    expect(await receipts(org)).toHaveLength(2);
    // Sem chave, nada sai: nem a lista de vozes, nem o teste.
    providerRequests.length = 0;
    expect((await call(getVoices, { cookie: owner.cookie, params: { synthesizer: "elevenlabs" } })).data).toEqual({ configured: false, voices: [], failure: null });
    expect((await call(retestKey, { method: "POST", cookie: owner.cookie, params: { synthesizer: "elevenlabs" } })).status).toBe(409);
    expect(providerRequests).toEqual([]);
    // A mesma chave de antes, depois de apagada, é chave nova: pede confirmação de novo.
    expect((await save(owner.cookie, { apiKey: OTHER_KEY })).status).toBe(422);
    expect(await receipts(org)).toHaveLength(2);
  });

  it("quem confirmou sai da equipe: o recibo fica com o nome, e a tela diz que a pessoa saiu", async () => {
    const leaving = await createUser(panel.app, org, "admin");
    expect((await save(leaving.cookie, { apiKey: KEY, ...confirmed })).status).toBe(200);
    expect((await call(removeMember, { method: "DELETE", cookie: owner.cookie, params: { id: leaving.id } })).status).toBe(200);
    const last = (await receipts(org)).at(-1);
    expect(last).toMatchObject({ actor_user_id: null, payload: { confirmedByName: "Test admin", provider: "elevenlabs" } });
    const all = await call(listAll, { cookie: owner.cookie });
    expect(all.data).toEqual([expect.objectContaining({ configured: true, consent: { name: null, at: NOW.toISOString() } })]);
  });

  it("o recibo aparece no Registro da privacidade, e outra organização não o vê", async () => {
    const mine = await call(getPrivacy, { cookie: owner.cookie });
    const shown = (mine.data as { history: Array<{ kind: string; payload: Record<string, unknown> }> }).history.filter((entry) => entry.kind === "synthesizer_provider_confirmed");
    expect(shown).toHaveLength(3);
    expect(await receipts(otherOrg)).toEqual([]);
    const theirs = await call(getPrivacy, { cookie: otherOwner });
    expect((theirs.data as { history: Array<{ kind: string }> }).history.some((entry) => entry.kind === "synthesizer_provider_confirmed")).toBe(false);
    expect((await call(listAll, { cookie: otherOwner })).data).toEqual([expect.objectContaining({ configured: false, consent: null })]);
  });
});
