import { encryptSecret, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { SECRET_KEY, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as readSetting, PUT as writeSetting } from "./settings/[key]/route";

const panel = startPanel();
afterAll(() => panel.close());

const KEY = "calls.analysis_brain";
const PRICE = { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "https://exemplo.invalid/precos", checkedOn: "2026-03-01" };

async function setup(label: string) {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  return { org, cookie: owner.cookie };
}

/** A chave do cérebro e a lista guardada dela, como a tela de Cérebros grava. */
const withBrain = (org: string, brain: string, options: { key?: boolean } = {}) =>
  withOrg(panel.app, org, async (q) => {
    if (options.key !== false)
      await q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, to_jsonb($3::text), true)", [org, `brain.${brain}.api_key`, encryptSecret("chave-inventada", SECRET_KEY)]);
    await q.exec("insert into settings (organization_id, key, value) values ($1, $2, $3)", [
      org,
      `brain.${brain}.models`,
      JSON.stringify({ fetchedAt: "2026-03-01T15:00:00.000Z", models: [{ id: "com-preco", label: "Com preço", price: PRICE }, { id: "sem-preco", label: "Sem preço" }] }),
    ]);
  });

const put = (cookie: string, value: unknown) => call(writeSetting, { method: "PUT", cookie, params: { key: KEY }, body: { value } });
const read = async (cookie: string) => (await call(readSetting, { cookie, params: { key: KEY } })).data as { value: unknown };
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];

describe("calls.analysis_brain: quem lê a ligação", () => {
  it("ausente vale o motor do agente", async () => {
    const { cookie } = await setup("cerebro escolha ausente");
    expect((await read(cookie)).value).toBeNull();
  });

  it("modelo com preço da lista guardada: grava cérebro e modelo, e remover volta ao motor", async () => {
    const { org, cookie } = await setup("cerebro escolha com preco");
    await withBrain(org, "openai");

    expect((await put(cookie, { brain: "openai", model: "com-preco" })).status).toBe(200);
    expect((await read(cookie)).value).toEqual({ brain: "openai", model: "com-preco" });

    expect((await put(cookie, null)).status).toBe(200);
    expect((await read(cookie)).value).toBeNull();
  });

  it("modelo sem preço só com acceptUnmeasured, que não é gravado", async () => {
    const { org, cookie } = await setup("cerebro escolha sem preco");
    await withBrain(org, "openai");

    expect(refusal(await put(cookie, { brain: "openai", model: "sem-preco" }))).toEqual([400, "brain_model_unmeasured"]);
    expect((await read(cookie)).value).toBeNull();

    expect((await put(cookie, { brain: "openai", model: "sem-preco", acceptUnmeasured: true })).status).toBe(200);
    const stored = await withOrg(panel.app, org, (q) => q.one<{ value: unknown }>("select value from settings where key = $1", [KEY]));
    expect(stored?.value).toEqual({ brain: "openai", model: "sem-preco" });
  });

  it("recusa modelo fora da lista guardada, cérebro sem chave e cérebro desconhecido", async () => {
    const { org, cookie } = await setup("cerebro escolha recusas");
    await withBrain(org, "openai");
    await withBrain(org, "anthropic", { key: false });

    expect(refusal(await put(cookie, { brain: "openai", model: "fora-da-lista" }))).toEqual([400, "brain_model_not_listed"]);
    expect(refusal(await put(cookie, { brain: "anthropic", model: "com-preco" }))).toEqual([400, "brain_no_key"]);
    expect(refusal(await put(cookie, { brain: "nao-existe", model: "com-preco" }))).toEqual([400, "unknown_brain"]);
    expect(refusal(await put(cookie, { brain: "openai" }))).toEqual([400, "validation_error"]);
    expect((await read(cookie)).value).toBeNull();
  });

  it("a lista de outra organização não vale aqui", async () => {
    const a = await setup("cerebro escolha org a");
    const b = await setup("cerebro escolha org b");
    await withBrain(a.org, "openai");

    expect(refusal(await put(b.cookie, { brain: "openai", model: "com-preco" }))).toEqual([400, "brain_no_key"]);
  });
});
