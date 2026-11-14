import { afterAll, describe, expect, it } from "vitest";
import { call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as engines } from "./engines/route";
import { PUT as putSetting } from "./settings/[key]/route";

const panel = startPanel();
afterAll(() => panel.close());

const BASE_URL = "engine.openai-realtime.base_url";
const MODEL = "engine.openai-realtime.classify_model";

const set = (cookie: string, key: string, value: unknown) => call(putSetting, { method: "PUT", cookie, params: { key }, body: { value } });
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];

interface EngineView {
  id: string;
  classifyTarget: boolean;
  baseUrl: string | null;
  classifyModel: string | null;
}

const viewOf = async (cookie: string): Promise<EngineView | undefined> => {
  const result = await call(engines, { cookie });
  return (result.data as EngineView[]).find((engine) => engine.id === "openai-realtime");
};

/**
 * O destino da classificação é configuração de operador, tem tela, e só vale para o motor que
 * declara aceitar endpoint e modelo próprios (`classifyTarget`).
 */
describe("settings: destino da classificação", () => {
  it("grava endpoint https público e nome de modelo, sem a barra final, e a tela os devolve", async () => {
    const org = await createOrganization(panel.app, "destino da classificação");
    const owner = await createUser(panel.app, org, "owner");
    expect((await viewOf(owner.cookie))).toMatchObject({ classifyTarget: true, baseUrl: null, classifyModel: null });

    expect((await set(owner.cookie, BASE_URL, "https://api.deepseek.com/v1/")).data).toEqual({ key: BASE_URL, value: "https://api.deepseek.com/v1" });
    expect((await set(owner.cookie, MODEL, " deepseek-chat ")).data).toEqual({ key: MODEL, value: "deepseek-chat" });
    expect(await viewOf(owner.cookie)).toMatchObject({ baseUrl: "https://api.deepseek.com/v1", classifyModel: "deepseek-chat" });

    // Em branco apaga: o motor volta ao endereço e ao modelo dele.
    expect((await set(owner.cookie, BASE_URL, null)).data).toEqual({ key: BASE_URL, value: null });
    expect((await viewOf(owner.cookie))).toMatchObject({ baseUrl: null, classifyModel: "deepseek-chat" });
  });

  it.each([
    ["http, que entregaria a chave sem cifra", "http://api.deepseek.com/v1"],
    ["loopback", "https://127.0.0.1:8443/v1"],
    ["localhost", "https://localhost:3000/v1"],
    ["rede privada", "https://192.168.0.10/v1"],
    ["link-local do metadado da nuvem", "https://169.254.169.254/latest"],
    ["sem esquema", "api.deepseek.com/v1"],
  ])("recusa endpoint %s", async (_reason, url) => {
    const org = await createOrganization(panel.app, `destino recusado ${url}`);
    const owner = await createUser(panel.app, org, "owner");
    expect(refusal(await set(owner.cookie, BASE_URL, url))).toEqual([400, "validation_error"]);
  });

  it.each([[""], ["deepseek chat"], ["../outro-modelo"], ["modelo".repeat(40)]])("recusa o modelo %j", async (model) => {
    const org = await createOrganization(panel.app, `modelo recusado ${model.slice(0, 8)}`);
    const owner = await createUser(panel.app, org, "owner");
    expect(refusal(await set(owner.cookie, MODEL, model))).toEqual([400, "validation_error"]);
  });

  it("só o motor que aceita destino próprio tem as duas configurações", async () => {
    const org = await createOrganization(panel.app, "destino só no motor compatível");
    const owner = await createUser(panel.app, org, "owner");
    for (const id of ["gemini-live", "simulated"]) {
      expect(refusal(await set(owner.cookie, `engine.${id}.base_url`, "https://api.deepseek.com/v1"))).toEqual([400, "unknown_setting"]);
      expect(refusal(await set(owner.cookie, `engine.${id}.classify_model`, "deepseek-chat"))).toEqual([400, "unknown_setting"]);
    }
  });
});
