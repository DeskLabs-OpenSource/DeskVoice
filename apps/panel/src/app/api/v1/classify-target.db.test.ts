import { decryptSecret, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { SECRET_KEY, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as engines } from "./engines/route";
import { GET as getSetting, PUT as putSetting } from "./settings/[key]/route";

const panel = startPanel();
afterAll(() => panel.close());

const TARGET = "engine.openai-realtime.classify_target";
const ENGINE_KEY = "engine.openai-realtime.api_key";

const set = (cookie: string, key: string, value: unknown) => call(putSetting, { method: "PUT", cookie, params: { key }, body: { value } });
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];

interface EngineView {
  id: string;
  classifyTarget: boolean;
  baseUrl: string | null;
  classifyModel: string | null;
  classifyKeyConfigured: boolean;
  keyConfigured: boolean;
}

const viewOf = async (cookie: string): Promise<EngineView | undefined> => {
  const result = await call(engines, { cookie });
  return (result.data as EngineView[]).find((engine) => engine.id === "openai-realtime");
};

/** O que ficou no banco, para conferir a cifra e qual chave está guardada. */
const storedOf = (org: string) =>
  withOrg(panel.app, org, async (q) => (await q.one<{ value: { baseUrl?: string; model?: string; apiKey?: string } }>("select value from settings where key = $1", [TARGET]))?.value);

const owner = async (label: string) => {
  const org = await createOrganization(panel.app, label);
  return { org, cookie: (await createUser(panel.app, org, "owner")).cookie };
};

/**
 * O destino da classificação é configuração de operador, tem tela, e só vale para o motor que
 * declara aceitar endpoint e modelo próprios (`classifyTarget`). Endpoint, modelo e chave do
 * endpoint andam juntos: a chave foi dada a um endereço, e a do motor nunca vai a ele.
 */
describe("settings: destino da classificação", () => {
  it("grava endpoint, modelo e a chave do endpoint cifrada; a tela vê só que a chave existe", async () => {
    const { org, cookie } = await owner("destino da classificação");
    expect(await viewOf(cookie)).toMatchObject({ classifyTarget: true, baseUrl: null, classifyModel: null, classifyKeyConfigured: false });

    const saved = await set(cookie, TARGET, { baseUrl: "https://api.deepseek.com/v1/", model: " deepseek-chat ", apiKey: "sk-do-endpoint" });
    expect(saved.data).toEqual({ key: TARGET, value: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: { configured: true } } });
    expect(await viewOf(cookie)).toMatchObject({ baseUrl: "https://api.deepseek.com/v1", classifyModel: "deepseek-chat", classifyKeyConfigured: true });
    expect((await call(getSetting, { cookie, params: { key: TARGET } })).data).toEqual(saved.data);

    const stored = await storedOf(org);
    expect(stored?.apiKey).not.toContain("sk-do-endpoint");
    expect(decryptSecret(stored?.apiKey ?? "", SECRET_KEY)).toBe("sk-do-endpoint");

    // Em branco apaga: o motor volta ao endereço, ao modelo e à chave dele.
    expect((await set(cookie, TARGET, null)).data).toEqual({ key: TARGET, value: null });
    expect(await viewOf(cookie)).toMatchObject({ baseUrl: null, classifyModel: null, classifyKeyConfigured: false });
  });

  it("trocar o endpoint não leva a chave junto: sem a chave nova, recusa; com ela, a antiga some", async () => {
    const { org, cookie } = await owner("destino trocado");
    await set(cookie, TARGET, { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-antiga" });

    // Mesmo endpoint, chave em branco: mantém a gravada (a tela nunca recebe o valor para devolver).
    expect((await set(cookie, TARGET, { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" })).status).toBe(200);
    expect(decryptSecret((await storedOf(org))?.apiKey ?? "", SECRET_KEY)).toBe("sk-antiga");

    expect(refusal(await set(cookie, TARGET, { baseUrl: "https://openrouter.ai/api/v1" }))).toEqual([400, "endpoint_key_required"]);
    expect((await storedOf(org))?.baseUrl).toBe("https://api.deepseek.com/v1");

    expect((await set(cookie, TARGET, { baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-nova" })).status).toBe(200);
    expect(decryptSecret((await storedOf(org))?.apiKey ?? "", SECRET_KEY)).toBe("sk-nova");

    // Tirar o endpoint e deixar só o modelo apaga a chave do endpoint: sem endpoint, vale a do motor.
    expect((await set(cookie, TARGET, { model: "gpt-5-mini" })).status).toBe(200);
    expect(await storedOf(org)).toEqual({ model: "gpt-5-mini" });
  });

  it("chave sem endpoint é recusada: ela pertence a um endereço", async () => {
    const { cookie } = await owner("chave sem endpoint");
    expect(refusal(await set(cookie, TARGET, { apiKey: "sk-solta" }))).toEqual([400, "endpoint_required"]);
  });

  it("o destino da classificação não toca na chave do motor, que é a da voz", async () => {
    const { org, cookie } = await owner("chave do motor intacta");
    await withOrg(panel.app, org, (q) => q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, '\"cifrada\"', true)", [org, ENGINE_KEY]));
    await set(cookie, TARGET, { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-do-endpoint" });
    await set(cookie, TARGET, { baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-outra" });
    await set(cookie, TARGET, null);
    expect(await withOrg(panel.app, org, (q) => q.one<{ value: unknown }>("select value from settings where key = $1", [ENGINE_KEY]))).toEqual({ value: "cifrada" });
    expect(await viewOf(cookie)).toMatchObject({ keyConfigured: true });
  });

  it.each([
    ["http, que entregaria a chave sem cifra", "http://api.deepseek.com/v1"],
    ["loopback", "https://127.0.0.1:8443/v1"],
    ["localhost", "https://localhost:3000/v1"],
    ["rede privada", "https://192.168.0.10/v1"],
    ["CGNAT", "https://100.64.0.1/v1"],
    ["link-local do metadado da nuvem", "https://169.254.169.254/latest"],
    ["IPv6 de uso local", "https://[fd00::1]/v1"],
    ["IPv6 link-local", "https://[fe80::1]/v1"],
    ["IPv4 embutido em IPv6", "https://[::ffff:7f00:1]/v1"],
    ["sem esquema", "api.deepseek.com/v1"],
  ])("recusa endpoint %s", async (_reason, url) => {
    const { cookie } = await owner(`destino recusado ${url}`);
    expect(refusal(await set(cookie, TARGET, { baseUrl: url, apiKey: "sk-do-endpoint" }))).toEqual([400, "validation_error"]);
  });

  it.each([[""], ["deepseek chat"], ["../outro-modelo"], ["modelo".repeat(40)]])("recusa o modelo %j", async (model) => {
    const { cookie } = await owner(`modelo recusado ${model.slice(0, 8)}`);
    expect(refusal(await set(cookie, TARGET, { model }))).toEqual([400, "validation_error"]);
  });

  it("só o motor que aceita destino próprio tem a configuração", async () => {
    const { cookie } = await owner("destino só no motor compatível");
    for (const id of ["gemini-live", "simulated"]) {
      expect(refusal(await set(cookie, `engine.${id}.classify_target`, { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk" }))).toEqual([400, "unknown_setting"]);
    }
  });
});
