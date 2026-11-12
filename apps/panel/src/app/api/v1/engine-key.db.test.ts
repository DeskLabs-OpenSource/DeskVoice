import { withOrg } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NOW, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { keyCheckLimiter } from "../../../server/engine-key";
import { POST as checkKey } from "./engines/[engine]/key-check/route";
import { GET as listEngines } from "./engines/route";
import { PUT as putSetting } from "./settings/[key]/route";
import { GET as health } from "./system/health/route";

const panel = startPanel();
afterAll(() => panel.close());

// Uma chave inventada, longa o bastante para aparecer em qualquer lugar onde vazasse.
const KEY = "sk-chave-inventada-que-nao-pode-voltar-0123456789";
const OPENAI = "engine.openai-realtime.api_key";

/** O provedor falso: responde ao `GET` do modelo; o resto (o processo de voz) continua recusado. */
let provider: { status: number; body: unknown };
const providerRequests: Array<{ url: string; authorization: string | null }> = [];
beforeEach(() => {
  panel.clock.at = NOW;
  keyCheckLimiter.clear();
  providerRequests.length = 0;
  provider = { status: 200, body: { id: "gpt-realtime-2.1", object: "model", created: 1, owned_by: "system" } };
  panel.voice.respond = (url, init) => {
    if (url.startsWith("https://api.openai.com/")) {
      providerRequests.push({ url, authorization: new Headers(init.headers).get("authorization") });
      return Response.json(provider.body, { status: provider.status });
    }
    throw new Error("connect ECONNREFUSED");
  };
});

async function setup(label: string) {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  return { org, owner: owner.cookie };
}
const save = (cookie: string, value: string | null) => call(putSetting, { method: "PUT", cookie, params: { key: OPENAI }, body: { value } });
const test = (cookie: string, engine = "openai-realtime") => call(checkKey, { method: "POST", cookie, params: { engine } });
const engineLine = async (cookie?: string) => {
  const report = (await call(health, { cookie })).data as { engine: { status: string; reason: string; detail: string; params: Record<string, string> } };
  return report.engine;
};

describe("engine key test", () => {
  it("saving a key tests it at once, and the key never comes back: not in the answer, the list nor the health", async () => {
    const { owner } = await setup("key saved");
    const saved = await save(owner, KEY);
    expect(saved.status).toBe(200);
    expect(saved.data).toEqual({ key: OPENAI, value: { configured: true }, check: { result: "accepted", model: "gpt-realtime-2.1", checkedAt: panel.clock.at.toISOString() } });
    // A chave foi ao provedor, pelo cabeçalho, e a nenhum outro lugar.
    expect(providerRequests).toEqual([{ url: "https://api.openai.com/v1/models/gpt-realtime-2.1", authorization: `Bearer ${KEY}` }]);

    const tested = await test(owner);
    const engines = await call(listEngines, { cookie: owner });
    const report = await call(health, { cookie: owner });
    for (const response of [saved, tested, engines, report]) expect(response.text).not.toContain(KEY);
    expect(tested.data).toEqual({ result: "accepted", model: "gpt-realtime-2.1", checkedAt: panel.clock.at.toISOString() });
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "openai-realtime", keyConfigured: true, keyCheck: tested.data }));
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "simulated", requiresKey: false, keyCheck: null }));
  });

  it("only owner and admin test; an engine without a key says so; the simulated engine needs none", async () => {
    const { org, owner } = await setup("key roles");
    const admin = await createUser(panel.app, org, "admin");
    const operator = await createUser(panel.app, org, "operator");
    const missing = await test(owner);
    expect([missing.status, missing.code]).toEqual([409, "engine_key_missing"]);
    await save(owner, KEY);
    const refused = await test(operator.cookie);
    expect([refused.status, refused.code]).toEqual([403, "forbidden"]);
    expect((await test(admin.cookie)).status).toBe(200);
    expect((await call(checkKey, { method: "POST", params: { engine: "openai-realtime" } })).status).toBe(401);
    expect((await test(owner, "made-up")).status).toBe(404);
    const simulated = await test(owner, "simulated");
    expect(simulated.data).toMatchObject({ result: "not_needed" });
    // Duas pelo salvamento e pelo administrador; nenhuma pelo operador, pelo motor simulado nem sem chave.
    expect(providerRequests).toHaveLength(2);
  });

  it("the button has a limit per engine: past it, nothing reaches the provider, and saving still saves", async () => {
    const { owner } = await setup("key limit");
    await save(owner, KEY);
    for (let attempt = 0; attempt < 4; attempt += 1) expect((await test(owner)).status).toBe(200);
    const limited = await test(owner);
    expect([limited.status, limited.code]).toEqual([429, "too_many_key_checks"]);
    expect(providerRequests).toHaveLength(5);
    // Gravar não é barrado pelo limite: a chave entra, e a resposta diz que o teste ficou para depois.
    const saved = await save(owner, `${KEY}-nova`);
    expect([saved.status, saved.data]).toEqual([200, { key: OPENAI, value: { configured: true }, check: null }]);
    expect(providerRequests).toHaveLength(5);
    // A janela passou: o botão volta a testar.
    panel.clock.at = new Date(panel.clock.at.getTime() + 11 * 60_000);
    expect((await test(owner)).status).toBe(200);
  });

  it("a rejected key turns the health line into a failure with what to do; replacing or removing the key drops the old result", async () => {
    const { org, owner } = await setup("key health");
    provider = { status: 401, body: { error: { message: "Incorrect API key provided", code: "invalid_api_key" } } };
    expect(((await save(owner, KEY)).data as { check: unknown }).check).toMatchObject({ result: "rejected" });
    let line = await engineLine(owner);
    expect([line.status, line.reason]).toEqual(["fail", "engine_key_rejected"]);
    expect(line.params).toMatchObject({ engine: "OpenAI Realtime" });
    expect(line.detail).toMatch(/foi recusada pelo provedor.*Cadastre uma chave válida/);
    // Sem sessão, a rota pública diz o estado e o que fazer, mas não o provedor nem o modelo.
    const outside = await engineLine();
    expect([outside.status, outside.reason]).toEqual(["fail", "engine_key_rejected"]);
    expect(JSON.stringify(outside)).not.toMatch(/OpenAI|gpt-/);
    expect(outside.detail).toMatch(/foi recusada pelo provedor.*Cadastre uma chave válida/);

    // Outra chave entra: o resultado da anterior some antes mesmo do teste novo.
    provider = { status: 429, body: { error: { code: "credit_balance_exhausted", type: "insufficient_quota" } } };
    expect(((await save(owner, `${KEY}-2`)).data as { check: unknown }).check).toMatchObject({ result: "no_credit" });
    expect((await engineLine()).reason).toBe("engine_no_credit");

    await save(owner, null);
    const left = await withOrg(panel.app, org, (q) => q.many<{ key: string }>("select key from settings where key like 'engine.openai-realtime.%'"));
    expect(left).toEqual([]);
    line = await engineLine();
    expect(line.reason).not.toMatch(/^engine_(key_rejected|no_credit)$/);
  });

  it("a result never lands on a key other than the one tested", async () => {
    const { org, owner } = await setup("key race");
    await save(owner, KEY);
    // Enquanto o provedor responde, a chave é trocada por outra (gravada direto, sem teste).
    panel.voice.respond = async (url) => {
      await withOrg(panel.app, org, (q) => q.exec("update settings set value = '\"outra\"' where key = $1", [OPENAI]));
      expect(url).toContain("/models/");
      return Response.json({ id: "gpt-realtime-2.1", object: "model" });
    };
    await withOrg(panel.app, org, (q) => q.exec("delete from settings where key = 'engine.openai-realtime.key_check'"));
    expect((await test(owner)).status).toBe(200);
    expect(await withOrg(panel.app, org, (q) => q.one("select key from settings where key = 'engine.openai-realtime.key_check'"))).toBeNull();
  });
});
