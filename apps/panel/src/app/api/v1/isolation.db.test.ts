import { withOrg } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { DELETE as deleteAgent, GET as getAgent, PATCH as patchAgent } from "./agents/[id]/route";
import { GET as listAgents } from "./agents/route";
import { POST as decide } from "./approvals/[id]/decide/route";
import { GET as listApprovals } from "./approvals/route";
import { GET as callEvents } from "./calls/[id]/events/route";
import { GET as getCall } from "./calls/[id]/route";
import { POST as outbound } from "./calls/outbound/route";
import { GET as listCalls } from "./calls/route";
import { POST as simulate } from "./calls/simulate/route";
import { POST as webCall } from "./calls/web/route";
import { POST as closeFollowUp } from "./follow-ups/[id]/close/route";
import { PATCH as assignFollowUp } from "./follow-ups/[id]/route";
import { GET as listFollowUps } from "./follow-ups/route";
import { POST as readNotification } from "./notifications/[id]/read/route";
import { DELETE as deleteNumber, PATCH as patchNumber } from "./phone-numbers/[id]/route";
import { POST as createNumber } from "./phone-numbers/route";
import { POST as checkTrunk } from "./trunks/[id]/check/route";
import { DELETE as deleteTrunk, PATCH as patchTrunk } from "./trunks/[id]/route";

const panel = startPanel();
let orgB: string;
let intruder: string;
let theirs: { agent: string; call: string; approval: string; trunk: string; number: string; notification: string; followUp: string };
let mine: { agent: string; trunk: string };

beforeAll(async () => {
  const orgA = await createOrganization(panel.app, "isolation A");
  orgB = await createOrganization(panel.app, "isolation B");
  // Dono da organização A: o papel mais alto, para que a única barreira em teste seja o isolamento.
  intruder = (await createUser(panel.app, orgA, "owner")).cookie;
  const agentSql = "insert into agents (organization_id, name, engine) values ($1, $2, 'simulated') returning id";
  const trunkSql = "insert into trunks (organization_id, name, host, auth_mode) values ($1, $2, 'sip.example.test', 'ip') returning id";
  mine = { agent: await insert(panel.app, orgA, agentSql, [orgA, "Mine"]), trunk: await insert(panel.app, orgA, trunkSql, [orgA, "Mine"]) };

  const agent = await insert(panel.app, orgB, agentSql, [orgB, "Theirs"]);
  const callId = await createCall(panel.app, orgB, NOW);
  const trunk = await insert(panel.app, orgB, trunkSql, [orgB, "Theirs"]);
  theirs = {
    agent,
    call: callId,
    trunk,
    approval: await insert(
      panel.app,
      orgB,
      "insert into approvals (organization_id, call_id, question, default_on_timeout, expires_at) values ($1, $2, 'Pode?', 'denied', $3) returning id",
      [orgB, callId, new Date(NOW.getTime() + 60_000)],
    ),
    number: await insert(panel.app, orgB, "insert into phone_numbers (organization_id, trunk_id, e164) values ($1, $2, '+5531999990001') returning id", [orgB, trunk]),
    notification: await insert(panel.app, orgB, "insert into notifications (organization_id, channel, body) values ($1, 'panel', 'Aviso') returning id", [orgB]),
    followUp: await insert(panel.app, orgB, "insert into follow_ups (organization_id, call_id, title, due_at, created_at) values ($1, $2, 'Retornar', $3, $3) returning id", [orgB, callId, NOW]),
  };
  panel.voice.respond = () => Response.json({ callId: "should-never-be-asked" });
});
afterAll(() => panel.close());

const snapshot = () =>
  withOrg(panel.app, orgB, async (q) => ({
    agent: await q.one("select name, enabled from agents where id = $1", [theirs.agent]),
    approval: await q.one("select status, decided_by from approvals where id = $1", [theirs.approval]),
    trunk: await q.one("select name, host, status from trunks where id = $1", [theirs.trunk]),
    number: await q.one("select agent_id, e164 from phone_numbers where id = $1", [theirs.number]),
    notification: await q.one("select read_at from notifications where id = $1", [theirs.notification]),
    followUp: await q.one("select owner_user_id, status, closing_note from follow_ups where id = $1", [theirs.followUp]),
    numbers: await q.many("select e164 from phone_numbers"),
  }));

describe("a user of organization A, through every route that takes an id", () => {
  it("gets 404 for records of organization B, and nothing there changes", async () => {
    const before = await snapshot();
    const as = { cookie: intruder };
    const attempts: Array<[string, Promise<{ status: number; code: string | undefined }>]> = [
      ["GET agent", call(getAgent, { ...as, params: { id: theirs.agent } })],
      ["PATCH agent", call(patchAgent, { ...as, method: "PATCH", params: { id: theirs.agent }, body: { name: "Taken", enabled: false } })],
      ["DELETE agent", call(deleteAgent, { ...as, method: "DELETE", params: { id: theirs.agent } })],
      ["GET call", call(getCall, { ...as, params: { id: theirs.call } })],
      ["GET call events", call(callEvents, { ...as, params: { id: theirs.call } })],
      ["decide approval", call(decide, { ...as, method: "POST", params: { id: theirs.approval }, body: { decision: "approved" } })],
      ["PATCH trunk", call(patchTrunk, { ...as, method: "PATCH", params: { id: theirs.trunk }, body: { host: "evil.example.test" } })],
      ["check trunk", call(checkTrunk, { ...as, method: "POST", params: { id: theirs.trunk } })],
      ["PATCH number", call(patchNumber, { ...as, method: "PATCH", params: { id: theirs.number }, body: { agentId: mine.agent } })],
      ["correct their number", call(patchNumber, { ...as, method: "PATCH", params: { id: theirs.number }, body: { number: "(31) 97777-0000" } })],
      ["DELETE number", call(deleteNumber, { ...as, method: "DELETE", params: { id: theirs.number } })],
      ["DELETE trunk", call(deleteTrunk, { ...as, method: "DELETE", params: { id: theirs.trunk } })],
      ["read notification", call(readNotification, { ...as, method: "POST", params: { id: theirs.notification } })],
      ["assign their follow-up", call(assignFollowUp, { ...as, method: "PATCH", params: { id: theirs.followUp }, body: { ownerUserId: null } })],
      ["close their follow-up", call(closeFollowUp, { ...as, method: "POST", params: { id: theirs.followUp }, body: { status: "done", note: "Fechei." } })],
      ["simulate with their agent", call(simulate, { ...as, method: "POST", body: { agentId: theirs.agent } })],
      ["browser call with their agent", call(webCall, { ...as, method: "POST", body: { agentId: theirs.agent } })],
      ["outbound with their agent", call(outbound, { ...as, method: "POST", body: { agentId: theirs.agent, toE164: "(31) 99999-8888" } })],
      ["number on their trunk", call(createNumber, { ...as, method: "POST", body: { trunkId: theirs.trunk, number: "(31) 98888-7777" } })],
      ["their agent on my number", call(createNumber, { ...as, method: "POST", body: { trunkId: mine.trunk, number: "(31) 98888-7777", agentId: theirs.agent } })],
    ];
    for (const [what, attempt] of attempts) {
      const result = await attempt;
      expect([what, result.status, result.code]).toEqual([what, 404, "not_found"]);
    }
    expect(await snapshot()).toEqual(before);
    // Nenhum pedido chegou ao processo de voz em nome de outra organização.
    expect(panel.voice.requests).toEqual([]);
  });

  it("does not see records of organization B in any list", async () => {
    const lists = await Promise.all([
      ...[listAgents, listCalls, listApprovals, listFollowUps].map((handler) => call(handler, { cookie: intruder })),
      call(listFollowUps, { cookie: intruder, query: `?callId=${theirs.call}` }),
    ]);
    const text = lists.map((list) => list.text).join("\n");
    for (const id of Object.values(theirs)) expect(text).not.toContain(id);
    expect(lists[0]?.data).toMatchObject([{ id: mine.agent }]);
  });

  it("treats a malformed id as a record that does not exist", async () => {
    const result = await call(getAgent, { cookie: intruder, params: { id: "1 or 1=1" } });
    expect([result.status, result.code]).toEqual([404, "not_found"]);
  });
});
