import { decryptSecret, withOrg } from "@deskvoice/core";
import { loadBrains } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, SECRET_KEY, call, createOrganization, createUser, startPanel } from "../../../../../test/kit";
import { brainCheckLimiter, listBrains } from "../../../../server/brains";
import { DELETE as removeKey, PUT as saveKey } from "./[brain]/key/route";
import { GET as readModels } from "./[brain]/models/route";
import { POST as refreshModels } from "./[brain]/models/refresh/route";
import { GET as listAll } from "./route";

const panel = startPanel();
afterAll(() => panel.close());

// Chaves inventadas, sem o prefixo de nenhum provedor, longas o bastante para aparecer onde vazassem.
const KEY = "chave-de-teste-inventada-nao-real-0123456789";
const OTHER_KEY = "outra-chave-de-teste-inventada-nao-real-9876543210";

const OPENROUTER_MODELS = [
  {
    id: "vendor/modelo-com-preco",
    name: "Modelo com preço",
    context_length: 128000,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0.0000005", completion: "0.0000015" },
  },
  {
    // Cobra por pedido além do token: fica sem preço, e nunca com preço zero.
    id: "vendor/modelo-tarifa-por-pedido",
    name: "Modelo com tarifa",
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0.000001", completion: "0.000002", request: "0.01" },
  },
];

/** O provedor falso. `/key` do OpenRouter prova a chave; `/models` dele é público e responde sempre. */
let openrouterKey: { status: number; body: unknown };
let openrouterModels: unknown[];
let openai: { status: number; body: unknown };
const providerRequests: Array<{ url: string; authorization: string | null }> = [];
let written: string[] = [];

beforeEach(() => {
  panel.clock.at = NOW;
  brainCheckLimiter.clear();
  providerRequests.length = 0;
  openrouterKey = { status: 200, body: { data: { label: "teste", usage: 0, limit: null } } };
  openrouterModels = OPENROUTER_MODELS;
  openai = { status: 200, body: { object: "list", data: [{ id: "gpt-modelo-de-teste", object: "model", created: 1, owned_by: "system" }] } };
  panel.voice.respond = (url, init) => {
    providerRequests.push({ url, authorization: new Headers(init.headers).get("authorization") });
    if (url.startsWith("https://openrouter.ai/api/v1/key")) return Response.json(openrouterKey.body, { status: openrouterKey.status });
    if (url.startsWith("https://openrouter.ai/api/v1/models")) return Response.json({ data: openrouterModels });
    if (url.startsWith("https://api.openai.com/v1/models")) return Response.json(openai.body, { status: openai.status });
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

async function setup(label: string) {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  return { org, owner: owner.cookie };
}
const save = (cookie: string, apiKey: string, brain = "openrouter") => call(saveKey, { method: "PUT", cookie, params: { brain }, body: { apiKey } });
const remove = (cookie: string, brain = "openrouter") => call(removeKey, { method: "DELETE", cookie, params: { brain } });
const refresh = (cookie: string, brain = "openrouter") => call(refreshModels, { method: "POST", cookie, params: { brain } });
const models = (cookie: string, brain = "openrouter") => call(readModels, { cookie, params: { brain } });
const brainsOf = async (cookie: string) => (await call(listAll, { cookie })).data as Array<{ id: string; configured: boolean; keyCheck: unknown; modelCount: number | null; fetchedAt: string | null }>;
const settingsOf = (org: string, brain = "openrouter") =>
  withOrg(panel.app, org, (q) => q.many<{ key: string; value: unknown; secret: boolean }>("select key, value, secret from settings where key like $1 order by key", [`brain.${brain}.%`]));

describe("brain keys and model lists", () => {
  it("finds the same brains the package finds by folder", async () => {
    const byFolder = [...(await loadBrains()).keys()].sort();
    expect((await listBrains()).map((brain) => brain.id).sort()).toEqual(byFolder);
    expect(byFolder).toEqual(expect.arrayContaining(["anthropic", "deepseek", "gemini", "openai", "openrouter"]));
  });

  it("saving a key encrypts it, tests it at once by reading the list, and the key never comes back", async () => {
    const { org, owner } = await setup("brain key saved");
    const saved = await save(owner, KEY);
    expect([saved.status, saved.data]).toEqual([200, { configured: true, check: { result: "accepted", status: 200, checkedAt: NOW.toISOString() }, modelCount: 2 }]);
    // A chave foi ao provedor pelo cabeçalho, e só a ele.
    expect(providerRequests.map((request) => [new URL(request.url).pathname, request.authorization])).toEqual([
      ["/api/v1/key", `Bearer ${KEY}`],
      ["/api/v1/models", `Bearer ${KEY}`],
    ]);

    const rows = await settingsOf(org);
    expect(rows.map((row) => [row.key, row.secret])).toEqual([
      ["brain.openrouter.api_key", true],
      ["brain.openrouter.key_check", false],
      ["brain.openrouter.models", false],
    ]);
    const stored = rows[0]?.value;
    expect(typeof stored).toBe("string");
    expect(JSON.stringify(rows)).not.toContain(KEY);
    expect(decryptSecret(stored as string, SECRET_KEY)).toBe(KEY);

    const list = await models(owner);
    expect(list.data).toEqual({
      fetchedAt: NOW.toISOString(),
      stale: false,
      models: [
        {
          id: "vendor/modelo-com-preco",
          label: "Modelo com preço",
          contextTokens: 128000,
          price: { centsPerMillionInputTokens: 50, centsPerMillionOutputTokens: 150, source: "https://openrouter.ai/api/v1/models", checkedOn: "2026-03-01" },
        },
        // Sem preço conhecido: o campo some, nunca vira zero.
        { id: "vendor/modelo-tarifa-por-pedido", label: "Modelo com tarifa" },
      ],
    });
    const all = await call(listAll, { cookie: owner });
    expect(all.data).toContainEqual({
      id: "openrouter",
      label: "OpenRouter",
      keyUrl: "https://openrouter.ai/settings/keys",
      configured: true,
      keyCheck: { result: "accepted", status: 200, checkedAt: NOW.toISOString() },
      modelCount: 2,
      fetchedAt: NOW.toISOString(),
    });
    expect(all.data).toContainEqual(expect.objectContaining({ id: "anthropic", configured: false, keyCheck: null, modelCount: null }));

    const refreshed = await refresh(owner);
    for (const response of [saved, list, all, refreshed]) expect(response.text).not.toContain(KEY);
    // Nem log nem evento.
    expect(written.join("\n")).not.toContain(KEY);
    const events = await withOrg(panel.app, org, (q) =>
      q.one<{ found: number }>("select (select count(*) from organization_events e where e::text like $1) + (select count(*) from call_events e where e::text like $1) as found", [`%${KEY}%`]),
    );
    expect(Number(events?.found)).toBe(0);
  });

  it("an OpenRouter key the provider refuses does not pass because the model list is public", async () => {
    const { org, owner } = await setup("brain key refused");
    openrouterKey = { status: 401, body: { error: { message: `Invalid key ${KEY}`, code: 401 } } };
    const saved = await save(owner, KEY);
    expect(saved.data).toEqual({ configured: true, check: { result: "rejected", status: 401, checkedAt: NOW.toISOString() }, modelCount: null });
    // O texto do provedor, que aqui repete a chave, não chega a lugar nenhum.
    expect(saved.text).not.toContain("Invalid key");
    expect(providerRequests.map((request) => new URL(request.url).pathname)).toEqual(["/api/v1/key"]);
    expect((await settingsOf(org)).map((row) => row.key)).toEqual(["brain.openrouter.api_key", "brain.openrouter.key_check"]);
    expect((await models(owner)).data).toEqual({ fetchedAt: null, models: [], stale: false });
    const refreshed = await refresh(owner);
    expect(refreshed.data).toEqual({ fetchedAt: null, models: [], stale: true, check: { result: "rejected", status: 401, checkedAt: NOW.toISOString() } });
    expect(written.join("\n")).not.toContain(KEY);
  });

  it("replacing the key drops the old list in the same step; removing drops key, test and list", async () => {
    const { org, owner } = await setup("brain key replaced");
    await save(owner, KEY);
    expect((await models(owner)).data).toMatchObject({ models: [{ id: "vendor/modelo-com-preco" }, { id: "vendor/modelo-tarifa-por-pedido" }] });

    // A chave nova não alcança o provedor agora: a lista da anterior não pode aparecer como dela.
    openrouterKey = { status: 503, body: {} };
    const replaced = await save(owner, OTHER_KEY);
    expect((replaced.data as { check: unknown }).check).toEqual({ result: "unreachable", status: 503, checkedAt: NOW.toISOString() });
    expect((await settingsOf(org)).map((row) => row.key)).toEqual(["brain.openrouter.api_key", "brain.openrouter.key_check"]);
    expect((await models(owner)).data).toEqual({ fetchedAt: null, models: [], stale: false });
    expect((await brainsOf(owner)).find((brain) => brain.id === "openrouter")).toMatchObject({ configured: true, modelCount: null, fetchedAt: null });

    // Com o provedor de volta, a lista que entra é a da chave nova, lida com ela.
    openrouterKey = { status: 200, body: { data: {} } };
    openrouterModels = [OPENROUTER_MODELS[0]];
    providerRequests.length = 0;
    expect((await refresh(owner)).data).toMatchObject({ stale: false, models: [{ id: "vendor/modelo-com-preco" }] });
    expect(new Set(providerRequests.map((request) => request.authorization))).toEqual(new Set([`Bearer ${OTHER_KEY}`]));

    const removed = await remove(owner);
    expect([removed.status, removed.data]).toEqual([200, { configured: false }]);
    expect(await settingsOf(org)).toEqual([]);
    expect((await brainsOf(owner)).find((brain) => brain.id === "openrouter")).toMatchObject({ configured: false, keyCheck: null, modelCount: null });
    const missing = await refresh(owner);
    expect([missing.status, missing.code]).toEqual([409, "brain_key_missing"]);
  });

  it("each organization sees and changes only its own keys and lists", async () => {
    const a = await setup("brain org A");
    const b = await setup("brain org B");
    await save(a.owner, KEY);
    const seenByB = await call(listAll, { cookie: b.owner });
    expect((seenByB.data as Array<{ id: string }>).find((brain) => brain.id === "openrouter")).toMatchObject({ configured: false, keyCheck: null, modelCount: null, fetchedAt: null });
    expect(seenByB.text).not.toContain("modelo-com-preco");
    expect((await models(b.owner)).data).toEqual({ fetchedAt: null, models: [], stale: false });
    expect((await refresh(b.owner)).code).toBe("brain_key_missing");
    // A B remove a "dela", que não existe: a da A continua.
    await remove(b.owner);
    expect((await settingsOf(a.org)).map((row) => row.key)).toEqual(["brain.openrouter.api_key", "brain.openrouter.key_check", "brain.openrouter.models"]);
    expect(await settingsOf(b.org)).toEqual([]);
  });

  it("only owner and admin reach the routes; an unknown brain is not found; the body is checked", async () => {
    const { org, owner } = await setup("brain roles");
    const admin = await createUser(panel.app, org, "admin");
    const operator = await createUser(panel.app, org, "operator");
    for (const response of [await save(operator.cookie, KEY), await call(listAll, { cookie: operator.cookie }), await models(operator.cookie), await refresh(operator.cookie), await remove(operator.cookie)]) {
      expect([response.status, response.code]).toEqual([403, "forbidden"]);
    }
    expect((await call(listAll)).status).toBe(401);
    expect((await save(owner, KEY, "made-up")).status).toBe(404);
    expect((await models(owner, "made-up")).status).toBe(404);
    const empty = await call(saveKey, { method: "PUT", cookie: owner, params: { brain: "openrouter" }, body: { apiKey: "   " } });
    expect([empty.status, empty.code]).toEqual([400, "validation_error"]);
    expect((await save(admin.cookie, KEY)).status).toBe(200);
    expect(providerRequests).toHaveLength(2);
  });

  it("five list reads per brain and organization in ten minutes; past it nothing reaches the provider, and saving still saves", async () => {
    const { org, owner } = await setup("brain limit");
    const other = await setup("brain limit other");
    await save(owner, KEY);
    for (let attempt = 0; attempt < 4; attempt += 1) expect((await refresh(owner)).status).toBe(200);
    const before = providerRequests.length;
    const limited = await refresh(owner);
    expect([limited.status, limited.code]).toEqual([429, "too_many_brain_checks"]);
    // Gravar não é barrado pelo limite: a chave entra, e a resposta diz que o teste ficou para depois.
    const saved = await save(owner, OTHER_KEY);
    expect([saved.status, saved.data]).toEqual([200, { configured: true, check: null, modelCount: null }]);
    expect(providerRequests).toHaveLength(before);
    expect((await settingsOf(org)).map((row) => row.key)).toEqual(["brain.openrouter.api_key"]);
    // O limite é por cérebro e por organização.
    expect((await save(owner, KEY, "openai")).status).toBe(200);
    expect(((await save(other.owner, KEY)).data as { check: unknown }).check).toMatchObject({ result: "accepted" });
    // A janela passou: o botão volta a ler.
    panel.clock.at = new Date(NOW.getTime() + 11 * 60_000);
    expect((await refresh(owner)).data).toMatchObject({ stale: false, check: { result: "accepted" } });
  });

  it("a list older than a day is read again when asked, inside the same limit; if that fails, the kept list comes back stale", async () => {
    const { owner } = await setup("brain stale");
    await save(owner, KEY);
    // Ainda dentro do dia: nada é pedido.
    panel.clock.at = new Date(NOW.getTime() + 23 * 60 * 60_000);
    providerRequests.length = 0;
    expect((await models(owner)).data).toMatchObject({ fetchedAt: NOW.toISOString(), stale: false });
    expect(providerRequests).toEqual([]);

    // Passou de um dia e o provedor está fora: vem a guardada, marcada como velha.
    panel.clock.at = new Date(NOW.getTime() + 25 * 60 * 60_000);
    openrouterKey = { status: 503, body: {} };
    const failed = await models(owner);
    expect(failed.data).toMatchObject({ fetchedAt: NOW.toISOString(), stale: true, models: [{ id: "vendor/modelo-com-preco" }, { id: "vendor/modelo-tarifa-por-pedido" }] });
    expect(providerRequests).toHaveLength(1);

    // Esgotado o limite (a releitura acima contou), a lista velha vem sem pedido ao provedor.
    for (let attempt = 0; attempt < 4; attempt += 1) await refresh(owner);
    providerRequests.length = 0;
    expect((await models(owner)).data).toMatchObject({ stale: true });
    expect(providerRequests).toEqual([]);

    // Na janela seguinte, com o provedor de volta, a lista é relida e deixa de ser velha.
    panel.clock.at = new Date(panel.clock.at.getTime() + 11 * 60_000);
    openrouterKey = { status: 200, body: { data: {} } };
    expect((await models(owner)).data).toMatchObject({ fetchedAt: panel.clock.at.toISOString(), stale: false });
  });

  it("a test result or list never lands on a key other than the one tested", async () => {
    const { org, owner } = await setup("brain race");
    await save(owner, KEY);
    await withOrg(panel.app, org, (q) => q.exec("delete from settings where key in ('brain.openrouter.key_check', 'brain.openrouter.models')"));
    // Enquanto o provedor responde, a chave é trocada por outra (gravada direto, sem teste).
    panel.voice.respond = async (url) => {
      if (url.includes("/key")) {
        await withOrg(panel.app, org, (q) => q.exec("update settings set value = '\"outra\"' where key = 'brain.openrouter.api_key'"));
        return Response.json({ data: {} });
      }
      return Response.json({ data: OPENROUTER_MODELS });
    };
    const refreshed = await refresh(owner);
    expect(refreshed.data).toEqual({ fetchedAt: null, models: [], stale: true, check: null });
    expect((await settingsOf(org)).map((row) => row.key)).toEqual(["brain.openrouter.api_key"]);
  });

  it("a stored list out of shape never reaches the screen", async () => {
    const { org, owner } = await setup("brain bad list");
    await save(owner, KEY);
    await withOrg(panel.app, org, (q) =>
      q.exec("update settings set value = $1 where key = 'brain.openrouter.models'", [JSON.stringify({ fetchedAt: NOW.toISOString(), models: [{ id: "x", label: "x", price: { centsPerMillionInputTokens: -1 } }] })]),
    );
    expect((await models(owner)).data).toEqual({ fetchedAt: null, models: [], stale: false });
    expect((await brainsOf(owner)).find((brain) => brain.id === "openrouter")).toMatchObject({ modelCount: null });
  });
});
