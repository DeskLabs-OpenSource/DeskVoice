import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { GET as callerHistory } from "./calls/[id]/caller-history/route";
import { POST as simulate } from "./calls/simulate/route";

/** O bloco "Este número" da tela da chamada, pela API: o número do outro lado, só desta organização. */
const panel = startPanel();
afterAll(() => panel.close());

const PHONE = "+5531933332222";
const setFrom = (callId: string, phone: string) => withSystem(panel.app, (q) => q.exec("update calls set from_e164 = $2 where id = $1", [callId, phone]));

describe("GET /calls/:id/caller-history", () => {
  it("devolve as ligações anteriores e as pendências abertas do mesmo número, e nada da outra organização", async () => {
    const mine = await createOrganization(panel.app, "historico minha");
    const theirs = await createOrganization(panel.app, "historico deles");
    const { cookie } = await createUser(panel.app, mine, "operator");
    const before = await createCall(panel.app, mine, new Date(NOW.getTime() - 86_400_000));
    const current = await createCall(panel.app, mine, NOW);
    const other = await createCall(panel.app, theirs, new Date(NOW.getTime() - 3_600_000));
    for (const id of [before, current, other]) await setFrom(id, PHONE);
    await insert(panel.app, mine, "insert into follow_ups (organization_id, call_id, caller_e164, title, due_at, created_at) values ($1, $2, $3, 'Retornar', $4, $4) returning id", [mine, before, PHONE, NOW]);
    await insert(panel.app, theirs, "insert into follow_ups (organization_id, call_id, caller_e164, title, due_at, created_at) values ($1, $2, $3, 'Deles', $4, $4) returning id", [theirs, other, PHONE, NOW]);

    const result = await call(callerHistory, { cookie, params: { id: current } });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ phone: PHONE, callCount: 1, calls: [{ id: before }], openFollowUpCount: 1, openFollowUps: [{ title: "Retornar", callId: before }] });
    expect(result.text).not.toContain(other);
    expect(result.text).not.toContain("Deles");
  });

  it("chamada sem número responde phone: null, e a tela não mostra o bloco", async () => {
    const org = await createOrganization(panel.app, "historico sem numero");
    const { cookie } = await createUser(panel.app, org, "operator");
    const anonymous = await createCall(panel.app, org, NOW);
    expect((await call(callerHistory, { cookie, params: { id: anonymous } })).data).toEqual({ phone: null, callCount: 0, simulatedCallCount: 0, calls: [], openFollowUpCount: 0, simulatedOpenFollowUpCount: 0, openFollowUps: [], noteCount: 0, simulatedNoteCount: 0, notes: [] });
  });
});

describe("POST /calls/simulate com o número de quem liga", () => {
  it("normaliza o número e o repassa ao processo de voz; número inválido é recusado antes", async () => {
    const org = await createOrganization(panel.app, "simulada com numero");
    const { cookie } = await createUser(panel.app, org, "operator");
    const agent = await insert(panel.app, org, "insert into agents (organization_id, name, engine) values ($1, 'Recepção', 'simulated') returning id", [org]);
    panel.voice.requests.length = 0;
    panel.voice.respond = () => Response.json({ callId: "simulada" });

    expect((await call(simulate, { cookie, method: "POST", body: { agentId: agent, from: "(31) 93333-2222" } })).status).toBe(200);
    expect(panel.voice.requests.at(-1)?.body).toEqual({ organizationId: org, agentId: agent, fromE164: PHONE });

    expect((await call(simulate, { cookie, method: "POST", body: { agentId: agent } })).status).toBe(200);
    expect(panel.voice.requests.at(-1)?.body).toEqual({ organizationId: org, agentId: agent });

    const refused = await call(simulate, { cookie, method: "POST", body: { agentId: agent, from: "não é número" } });
    expect(refused.status).toBe(400);
    expect(panel.voice.requests).toHaveLength(2);
  });
});
