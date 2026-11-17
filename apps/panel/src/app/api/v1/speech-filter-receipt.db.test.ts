// O recibo da confirmação do filtro de fala (ajuste do #395): cada confirmação nova grava
// `decision_model_provider_confirmed` em `organization_events`, na mesma transação do salvamento, com
// o nome de quem confirmou. A `settings` (`calls.decision_model_confirmation`) continua sendo a trava
// do momento: desligar e trocar de modelo a apagam, e o recibo fica no Registro da privacidade.
import type * as core from "@deskvoice/core";
import { withOrg } from "@deskvoice/core";
import type { DecisionModel } from "@deskvoice/voice-engine";
import { DECISION_MODEL_SETTING } from "@deskvoice/voice-engine/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import type * as Pieces from "../../../server/pieces";
import { GET as getPrivacy } from "./privacy/route";
import { PUT as putKey } from "./speech-filter/[model]/key/route";
import { PUT as putFilter } from "./speech-filter/route";

// O recibo pode falhar de propósito, para provar que ele está na mesma transação do salvamento.
const failReceipt = vi.hoisted(() => ({ on: false }));
vi.mock("@deskvoice/core", async (importOriginal) => {
  const original = await importOriginal<typeof core>();
  return {
    ...original,
    recordOrgEvent: (...args: Parameters<typeof original.recordOrgEvent>) =>
      failReceipt.on && args[1] === "decision_model_provider_confirmed" ? Promise.reject(new Error("receipt failed on purpose")) : original.recordOrgEvent(...args),
  };
});

// Um modelo que roda neste servidor e não pede chave, só neste teste: com ele se prova que trocar o
// Jev por outro modelo apaga a confirmação vigente (o ramo que não pede confirmação) e deixa o recibo.
vi.mock("../../../server/pieces", async (importOriginal) => {
  const original = await importOriginal<typeof Pieces>();
  const local: DecisionModel = {
    id: "local_test",
    label: "Local de teste",
    provider: "deskvoice",
    processingLocation: { kind: "this-server" },
    keyless: true,
    pricing: { checkedOn: "2026-11-17", source: "teste" },
    decide: () => Promise.reject(new Error("never called here")),
  };
  return { ...original, listDecisionModels: async () => [...(await original.listDecisionModels()), local] };
});

const panel = startPanel();
afterAll(() => panel.close());

const CONFIRMATION = "calls.decision_model_confirmation";
let org: string;
let otherOrg: string;
let owner: { id: string; cookie: string };
let admin: { id: string; cookie: string };
let otherOwner: string;

const receipts = (organizationId: string) =>
  withOrg(panel.app, organizationId, (q) =>
    q.many<{ kind: string; actor_user_id: string | null; payload: Record<string, unknown>; at: Date }>(
      "select kind, actor_user_id, payload, at from organization_events where kind = 'decision_model_provider_confirmed' order by id",
    ),
  );
const setting = (organizationId: string, key: string) => withOrg(panel.app, organizationId, (q) => q.one<{ value: unknown }>("select value from settings where key = $1", [key]));
const turnOn = (cookie: string, extra: object = { confirmedProvider: "typesafe" }) => call(putFilter, { method: "PUT", cookie, body: { model: "jev", ...extra } });

beforeAll(async () => {
  org = await createOrganization(panel.app, "speech-filter-receipt");
  otherOrg = await createOrganization(panel.app, "speech-filter-receipt-other");
  owner = await createUser(panel.app, org, "owner");
  admin = await createUser(panel.app, org, "admin");
  otherOwner = (await createUser(panel.app, otherOrg, "owner")).cookie;
  panel.voice.respond = (url) =>
    url.startsWith("https://api.typesafe.ai/v1/models") ? Response.json({ models: [{ name: "jev-latest" }] }) : new Response("unexpected", { status: 500 });
  const key = await call(putKey, { method: "PUT", cookie: owner.cookie, params: { model: "jev" }, body: { apiKey: "ts-secret-key-for-the-test" } });
  expect(key.status).toBe(200);
});

beforeEach(() => {
  panel.clock.at = NOW;
});

describe("o recibo da confirmação do filtro de fala", () => {
  it("sem a confirmação, nada é gravado, nem o recibo", async () => {
    for (const extra of [{}, { confirmedProvider: "openai" }]) expect((await turnOn(owner.cookie, extra)).status).toBe(400);
    expect(await receipts(org)).toEqual([]);
  });

  it("se o recibo falha, a escolha e a confirmação também não ficam: estão na mesma transação", async () => {
    failReceipt.on = true;
    try {
      expect((await turnOn(owner.cookie)).status).toBe(500);
    } finally {
      failReceipt.on = false;
    }
    expect(await setting(org, DECISION_MODEL_SETTING)).toBeNull();
    expect(await setting(org, CONFIRMATION)).toBeNull();
    expect(await receipts(org)).toEqual([]);
  });

  it("confirmar grava 1 recibo, com o nome de quem confirmou, o fornecedor e o modelo", async () => {
    panel.clock.at = new Date("2026-03-01T16:30:00.000Z");
    const saved = await turnOn(admin.cookie);
    expect([saved.status, saved.message]).toEqual([200, undefined]);
    expect(await receipts(org)).toEqual([
      {
        kind: "decision_model_provider_confirmed",
        actor_user_id: admin.id,
        at: panel.clock.at,
        payload: { decisionModel: "jev", provider: "typesafe", confirmedByName: "Test admin" },
      },
    ]);
    // Nem chave nem e-mail no recibo.
    expect(JSON.stringify(await receipts(org))).not.toMatch(/ts-secret|@/);
  });

  it("salvar de novo o mesmo modelo já confirmado não gera recibo novo, nem com a confirmação de novo", async () => {
    panel.clock.at = new Date("2026-03-02T09:00:00.000Z");
    expect((await turnOn(owner.cookie, {})).status).toBe(200);
    expect((await turnOn(owner.cookie)).status).toBe(200);
    expect(await receipts(org)).toHaveLength(1);
    // A confirmação vigente continua a primeira: quem e quando batem com o recibo.
    expect((await setting(org, CONFIRMATION))?.value).toMatchObject({ userId: admin.id, at: "2026-03-01T16:30:00.000Z" });
  });

  it("desligar apaga a confirmação vigente e deixa o recibo; religar confirma de novo e grava outro", async () => {
    const off = await call(putFilter, { method: "PUT", cookie: owner.cookie, body: { model: null } });
    expect(off.status).toBe(200);
    expect(await setting(org, CONFIRMATION)).toBeNull();
    expect(await receipts(org)).toHaveLength(1);

    expect((await turnOn(owner.cookie, {})).status).toBe(400);
    panel.clock.at = new Date("2026-03-03T10:00:00.000Z");
    expect((await turnOn(owner.cookie)).status).toBe(200);
    const all = await receipts(org);
    expect(all.map((receipt) => [receipt.actor_user_id, receipt.payload.confirmedByName])).toEqual([
      [admin.id, "Test admin"],
      [owner.id, "Test owner"],
    ]);
  });

  it("trocar de modelo apaga a confirmação vigente e deixa o recibo", async () => {
    const switched = await call(putFilter, { method: "PUT", cookie: owner.cookie, body: { model: "local_test" } });
    expect([switched.status, switched.message]).toEqual([200, undefined]);
    expect((await setting(org, DECISION_MODEL_SETTING))?.value).toBe("local_test");
    expect(await setting(org, CONFIRMATION)).toBeNull();
    expect(await receipts(org)).toHaveLength(2);
  });

  it("o recibo aparece no Registro da privacidade, e outra organização não o vê", async () => {
    const mine = await call(getPrivacy, { cookie: owner.cookie });
    const shown = (mine.data as { history: Array<{ kind: string; payload: Record<string, unknown> }> }).history.filter((entry) => entry.kind === "decision_model_provider_confirmed");
    expect(shown.map((entry) => entry.payload.confirmedByName)).toEqual(["Test owner", "Test admin"]);

    expect(await receipts(otherOrg)).toEqual([]);
    const theirs = await call(getPrivacy, { cookie: otherOwner });
    expect((theirs.data as { history: Array<{ kind: string }> }).history.some((entry) => entry.kind === "decision_model_provider_confirmed")).toBe(false);
  });
});
