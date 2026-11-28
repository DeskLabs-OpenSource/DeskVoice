// A confirmação da transcrição de fora do servidor pela tela (desenho do pipeline, seção 9.1, fatia 6):
// a transcrição da OpenAI não tem chave própria (usa a do motor OpenAI Realtime), e a confirmação tem
// rota própria. Ela pede o fornecedor por extenso (sem ele, 422 e nenhum recibo), grava o recibo
// `transcriber_provider_confirmed` uma vez, e apagar deixa o recibo. A lista diz se a chave existe,
// e nunca o valor, e cada organização tem a sua.
import { encryptSecret, withOrg } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOW, SECRET_KEY, call, createOrganization, createUser, startPanel } from "../../../../../test/kit";
import { GET as getPrivacy } from "../privacy/route";
import { DELETE as removeConsent, PUT as putConsent } from "./[transcriber]/consent/route";
import { GET as listAll } from "./route";

const panel = startPanel();
afterAll(() => panel.close());

const ENGINE_KEY = "chave-do-motor-inventada-nao-real-0123456789";

let org: string;
let otherOrg: string;
let owner: { id: string; cookie: string };
let ownerName: string;
let operator: { id: string; cookie: string };
let otherOwner: string;

beforeAll(async () => {
  org = await createOrganization(panel.app, "transcricao confirmacao");
  otherOrg = await createOrganization(panel.app, "transcricao outra");
  owner = await createUser(panel.app, org, "owner");
  ownerName = (await withOrg(panel.app, org, (q) => q.one<{ name: string }>("select name from users where id = $1", [owner.id])))?.name ?? "";
  operator = await createUser(panel.app, org, "operator");
  otherOwner = (await createUser(panel.app, otherOrg, "owner")).cookie;
});

const receipts = (organizationId: string) =>
  withOrg(panel.app, organizationId, (q) =>
    q.many<{ actor_user_id: string | null; payload: Record<string, unknown> }>("select actor_user_id, payload from organization_events where kind = 'transcriber_provider_confirmed' order by id"),
  );
const confirm = (cookie: string, body: object) => call(putConsent, { method: "PUT", cookie, params: { transcriber: "openai" }, body });
const list = async (cookie: string) => (await call(listAll, { cookie })).data as Array<Record<string, unknown>>;

describe("a confirmação da transcrição de fora do servidor (fatia 6)", () => {
  it("a lista traz só as de verdade (sem a simulada), sem chave e sem confirmação", async () => {
    const all = await list(owner.cookie);
    expect(all).toEqual([{ id: "openai", label: "OpenAI (gpt-4o-mini-transcribe)", provider: "openai", processingLocation: { kind: "undeclared" }, keyConfigured: false, consent: null }]);
  });

  it("a chave é a do motor OpenAI Realtime da organização, e só se diz que existe", async () => {
    await withOrg(panel.app, org, (q) =>
      q.exec("insert into settings (organization_id, key, value, secret) values ($1, 'engine.openai-realtime.api_key', $2, true)", [org, JSON.stringify(encryptSecret(ENGINE_KEY, SECRET_KEY))]),
    );
    const response = await call(listAll, { cookie: owner.cookie });
    expect((response.data as Array<Record<string, unknown>>)[0]?.keyConfigured).toBe(true);
    expect(response.text).not.toContain(ENGINE_KEY);
    expect((await list(otherOwner))[0]?.keyConfigured).toBe(false);
  });

  it("sem o fornecedor por extenso, 422 e nada é gravado", async () => {
    for (const [body, code] of [
      [{}, "provider_confirmation_required"],
      [{ confirmedProvider: "elevenlabs" }, "provider_confirmation_invalid"],
    ] as const) {
      const refused = await confirm(owner.cookie, body);
      expect([refused.status, refused.code]).toEqual([422, code]);
    }
    expect((await list(owner.cookie))[0]?.consent).toBeNull();
    expect(await receipts(org)).toEqual([]);
  });

  it("só quem configura confirma", async () => {
    expect((await confirm(operator.cookie, { confirmedProvider: "openai" })).status).toBe(403);
  });

  it("confirmar grava quem e quando, com um recibo só, mesmo confirmando de novo; e não vale para a outra organização", async () => {
    expect((await confirm(owner.cookie, { confirmedProvider: "openai" })).data).toEqual({ confirmed: true });
    expect((await confirm(owner.cookie, { confirmedProvider: "openai" })).status).toBe(200);
    expect((await list(owner.cookie))[0]?.consent).toEqual({ name: ownerName, at: NOW.toISOString() });
    expect(await receipts(org)).toEqual([{ actor_user_id: owner.id, payload: { transcriberId: "openai", provider: "openai", confirmedByName: ownerName } }]);
    expect((await list(otherOwner))[0]?.consent).toBeNull();
    const privacy = (await call(getPrivacy, { cookie: owner.cookie })).data as { history: Array<{ kind: string }> };
    expect(privacy.history.map((event) => event.kind)).toContain("transcriber_provider_confirmed");
  });

  it("apagar tira a confirmação e deixa o recibo; a peça que não existe é 404", async () => {
    expect((await call(removeConsent, { method: "DELETE", cookie: owner.cookie, params: { transcriber: "openai" } })).data).toEqual({ confirmed: false });
    expect((await list(owner.cookie))[0]?.consent).toBeNull();
    expect(await receipts(org)).toHaveLength(1);
    expect((await call(putConsent, { method: "PUT", cookie: owner.cookie, params: { transcriber: "simulated" }, body: { confirmedProvider: "none" } })).status).toBe(404);
  });
});
