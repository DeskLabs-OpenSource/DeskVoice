// O filtro da fala na tela (desenho R12, fatia 7b): ligar o Jev pede a chave salva e a confirmação
// nomeando o fornecedor; quem confirmou e quando ficam gravados e voltam na leitura; só dono e
// administrador mudam; e a escolha fica em `calls.decision_model`, a chave que a voz já lê.
import { decryptSecret, withOrg } from "@deskvoice/core";
import { DECISION_MODEL_SETTING, decisionModelKeySetting, decisionModelOf } from "@deskvoice/voice-engine/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NOW, SECRET_KEY, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { DELETE as removeKey, PUT as putKey } from "./speech-filter/[model]/key/route";
import { GET as getFilter, PUT as putFilter } from "./speech-filter/route";

const panel = startPanel();
afterAll(() => panel.close());

const JEV_KEY = "ts-secret-key-for-the-test";
let typesafe: { status: number; body: unknown };

let org: string;
let owner: string;
let admin: { id: string; cookie: string; name?: string };
let operator: string;

beforeAll(async () => {
  org = await createOrganization(panel.app, "speech-filter");
  owner = (await createUser(panel.app, org, "owner")).cookie;
  admin = await createUser(panel.app, org, "admin");
  operator = (await createUser(panel.app, org, "operator")).cookie;
});

beforeEach(() => {
  panel.clock.at = NOW;
  typesafe = { status: 200, body: { models: [{ name: "jev-latest" }] } };
  panel.voice.respond = (url) => {
    if (url.startsWith("https://api.typesafe.ai/v1/models")) return Response.json(typesafe.body, { status: typesafe.status });
    return new Response("unexpected", { status: 500 });
  };
});

interface View {
  model: string | null;
  confirmation: { provider: string; name: string; at: string } | null;
  models: Array<{ id: string; provider: string; processingLocation: unknown; key: { configured: boolean }; keyCheck: { result: string; checkedAt: string } | null }>;
}
const read = async (cookie: string): Promise<View> => {
  const got = await call(getFilter, { cookie });
  expect([got.status, got.message]).toEqual([200, undefined]);
  return got.data as View;
};
const setting = (organizationId: string, key: string) =>
  withOrg(panel.app, organizationId, async (q) => (await q.one<{ value: unknown; secret: boolean }>("select value, secret from settings where key = $1", [key])) ?? null);

describe("o filtro da fala na tela", () => {
  it("nasce desligado, oferece o Jev e não oferece o simulado", async () => {
    const view = await read(owner);
    expect(view.model).toBeNull();
    expect(view.confirmation).toBeNull();
    expect(view.models.map((model) => model.id)).toEqual(["jev"]);
    // O país só com fonte: a página da TypeSafe e o dia da leitura.
    expect(view.models[0]).toMatchObject({
      provider: "typesafe",
      processingLocation: { kind: "country", country: "US", source: { url: "https://typesafe.ai/legal/privacy-policy", checkedOn: "2026-11-16" } },
      key: { configured: false },
      keyCheck: null,
    });
    const simulated = await call(putFilter, { method: "PUT", cookie: owner, body: { model: "simulated" } });
    expect([simulated.status, simulated.code]).toEqual([400, "unknown_decision_model"]);
  });

  it("só dono e administrador mudam: o operador lê, e não liga, nem salva ou remove chave", async () => {
    expect((await read(operator)).model).toBeNull();
    const turnOn = await call(putFilter, { method: "PUT", cookie: operator, body: { model: "jev", confirmedProvider: "typesafe" } });
    expect([turnOn.status, turnOn.code]).toEqual([403, "forbidden"]);
    const turnOff = await call(putFilter, { method: "PUT", cookie: operator, body: { model: null } });
    expect([turnOff.status, turnOff.code]).toEqual([403, "forbidden"]);
    const key = await call(putKey, { method: "PUT", cookie: operator, params: { model: "jev" }, body: { apiKey: JEV_KEY } });
    expect([key.status, key.code]).toEqual([403, "forbidden"]);
    const removed = await call(removeKey, { method: "DELETE", cookie: operator, params: { model: "jev" } });
    expect([removed.status, removed.code]).toEqual([403, "forbidden"]);
    expect(await setting(org, decisionModelKeySetting("jev"))).toBeNull();
    expect(await setting(org, DECISION_MODEL_SETTING)).toBeNull();
    expect(panel.voice.requests.some((request) => request.url.includes("typesafe"))).toBe(false);
  });

  it("sem a chave salva, o Jev não liga", async () => {
    const turnOn = await call(putFilter, { method: "PUT", cookie: owner, body: { model: "jev", confirmedProvider: "typesafe" } });
    expect([turnOn.status, turnOn.code]).toEqual([400, "decision_model_key_missing"]);
    expect(await setting(org, DECISION_MODEL_SETTING)).toBeNull();
  });

  it("a chave é cifrada, testada pelo checkKey, e nunca volta na resposta", async () => {
    const saved = await call(putKey, { method: "PUT", cookie: owner, params: { model: "jev" }, body: { apiKey: JEV_KEY } });
    expect([saved.status, saved.data]).toEqual([200, { configured: true, check: { result: "accepted", model: "jev-latest", checkedAt: NOW.toISOString() } }]);
    expect(JSON.stringify(saved.data)).not.toContain(JEV_KEY);
    const row = await setting(org, decisionModelKeySetting("jev"));
    expect(row?.secret).toBe(true);
    expect(JSON.stringify(row?.value)).not.toContain(JEV_KEY);
    expect(decryptSecret(row?.value as string, SECRET_KEY)).toBe(JEV_KEY);
    const view = await read(operator);
    expect(JSON.stringify(view)).not.toContain(JEV_KEY);
    expect(view.models[0]).toMatchObject({ key: { configured: true }, keyCheck: { result: "accepted", checkedAt: NOW.toISOString() } });
  });

  it("a chave recusada diz o motivo pelo vocabulário fechado, sem o texto do fornecedor", async () => {
    typesafe = { status: 401, body: { error: { message: "invalid key ts-secret, contact support" } } };
    const saved = await call(putKey, { method: "PUT", cookie: admin.cookie, params: { model: "jev" }, body: { apiKey: `${JEV_KEY}-wrong` } });
    expect([saved.status, saved.data]).toEqual([200, { configured: true, check: { result: "rejected", model: "jev-latest", checkedAt: NOW.toISOString() } }]);
    expect(JSON.stringify(saved.data)).not.toContain("contact support");
    // Volta a chave boa para os casos seguintes.
    typesafe = { status: 200, body: { models: [{ name: "jev-latest" }] } };
    const good = await call(putKey, { method: "PUT", cookie: owner, params: { model: "jev" }, body: { apiKey: JEV_KEY } });
    expect((good.data as { check: { result: string } }).check.result).toBe("accepted");
  });

  it("sem a confirmação nomeando a TypeSafe, o Jev não salva", async () => {
    const without = await call(putFilter, { method: "PUT", cookie: owner, body: { model: "jev" } });
    expect([without.status, without.code]).toEqual([400, "provider_confirmation_required"]);
    const wrong = await call(putFilter, { method: "PUT", cookie: owner, body: { model: "jev", confirmedProvider: "openai" } });
    expect([wrong.status, wrong.code]).toEqual([400, "provider_confirmation_invalid"]);
    expect(await setting(org, DECISION_MODEL_SETTING)).toBeNull();
    expect((await read(owner)).confirmation).toBeNull();
  });

  it("escolhe o Jev, confirma, salva, recarrega e vê a escolha, com quem confirmou e quando", async () => {
    panel.clock.at = new Date("2026-03-01T16:30:00.000Z");
    const saved = await call(putFilter, { method: "PUT", cookie: admin.cookie, body: { model: "jev", confirmedProvider: "typesafe" } });
    expect([saved.status, saved.message]).toEqual([200, undefined]);
    // Recarregar é ler de novo, com outra sessão.
    const view = await read(operator);
    expect(view.model).toBe("jev");
    expect(view.confirmation).toEqual({ provider: "typesafe", name: "Test admin", at: "2026-03-01T16:30:00.000Z" });
    const confirmation = await setting(org, "calls.decision_model_confirmation");
    expect(confirmation?.value).toMatchObject({ model: "jev", provider: "typesafe", userId: admin.id, at: "2026-03-01T16:30:00.000Z" });
    expect(view.confirmation?.name).toBe((confirmation?.value as { name: string }).name);
    // A voz lê a mesma chave, no mesmo formato da fatia 6: o id do modelo, em texto.
    expect(decisionModelOf((await setting(org, DECISION_MODEL_SETTING))?.value)).toBe("jev");
  });

  it("salvar de novo o mesmo modelo mantém a confirmação; desligar a apaga, e religar pede outra", async () => {
    panel.clock.at = new Date("2026-03-02T09:00:00.000Z");
    const again = await call(putFilter, { method: "PUT", cookie: owner, body: { model: "jev" } });
    expect([again.status, again.message]).toEqual([200, undefined]);
    expect((await read(owner)).confirmation?.at).toBe("2026-03-01T16:30:00.000Z");

    const inUse = await call(removeKey, { method: "DELETE", cookie: owner, params: { model: "jev" } });
    expect([inUse.status, inUse.code]).toEqual([409, "decision_model_in_use"]);

    const off = await call(putFilter, { method: "PUT", cookie: owner, body: { model: null } });
    expect([off.status, (off.data as View).model, (off.data as View).confirmation]).toEqual([200, null, null]);
    expect(await setting(org, DECISION_MODEL_SETTING)).toBeNull();
    expect(await setting(org, "calls.decision_model_confirmation")).toBeNull();

    const backOn = await call(putFilter, { method: "PUT", cookie: owner, body: { model: "jev" } });
    expect([backOn.status, backOn.code]).toEqual([400, "provider_confirmation_required"]);

    const removed = await call(removeKey, { method: "DELETE", cookie: owner, params: { model: "jev" } });
    expect([removed.status, removed.data]).toEqual([200, { configured: false }]);
    expect(await setting(org, decisionModelKeySetting("jev"))).toBeNull();
    expect((await read(owner)).models[0]).toMatchObject({ key: { configured: false }, keyCheck: null });
  });

  it("outra organização não vê a escolha, a confirmação nem a chave desta", async () => {
    await call(putKey, { method: "PUT", cookie: owner, params: { model: "jev" }, body: { apiKey: JEV_KEY } });
    await call(putFilter, { method: "PUT", cookie: owner, body: { model: "jev", confirmedProvider: "typesafe" } });
    const otherOrg = await createOrganization(panel.app, "speech-filter-other");
    const otherOwner = (await createUser(panel.app, otherOrg, "owner")).cookie;
    const view = await read(otherOwner);
    expect(view.model).toBeNull();
    expect(view.confirmation).toBeNull();
    expect(view.models[0]).toMatchObject({ key: { configured: false }, keyCheck: null });
    const turnOn = await call(putFilter, { method: "PUT", cookie: otherOwner, body: { model: "jev", confirmedProvider: "typesafe" } });
    expect([turnOn.status, turnOn.code]).toEqual([400, "decision_model_key_missing"]);
  });

  it("a rota genérica de configuração não grava a escolha nem a chave por fora da confirmação", async () => {
    const { PUT: putSetting } = await import("./settings/[key]/route");
    for (const key of [DECISION_MODEL_SETTING, decisionModelKeySetting("jev"), "calls.decision_model_confirmation"]) {
      const saved = await call(putSetting, { method: "PUT", cookie: owner, params: { key }, body: { value: "jev" } });
      expect([key, saved.status, saved.code]).toEqual([key, 400, "unknown_setting"]);
    }
  });
});
