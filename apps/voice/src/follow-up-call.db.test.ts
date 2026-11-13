// A pendência nascida numa ligação de verdade (sessão, motor nas mãos do teste, banco real): o dono
// vem do agente, e o texto que o modelo mandou não fica na linha do tempo, nem quando a ferramenta
// não está habilitada para o agente.
import { withSystem } from "@deskvoice/core";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { createUser } from "../../../packages/tools/test/helpers";
import { startCallSession } from "./call-session";
import { createAgent, createCall, createOrganization, eventsOf, kindsOf, manualEngine, manualTransport, sessionHarness, type SessionHarness } from "./testing/db";
import { waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
let harness: SessionHarness | undefined;
afterEach(async () => {
  await harness?.approvals.close();
  harness = undefined;
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

const TITLE = "Retornar para Maria sobre o orçamento";
const DETAILS = "Quer o orçamento do pacote por e-mail até sexta.";
const CALLER = "+5531999990042";

async function scene(label: string, tools: string[]) {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { engine: "manual", tools });
  const person = await createUser(app, organizationId, null);
  await withSystem(app, (q) => q.exec("update agents set follow_up_owner_user_id = $2 where id = $1", [agentId, person]));
  const manual = manualEngine({ keyless: true });
  harness = await sessionHarness(app, [manual.engine]);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now());
  await withSystem(app, (q) => q.exec("update calls set from_e164 = $2 where id = $1", [callId, CALLER]));
  const transport = manualTransport();
  const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport });
  await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
  manual.emit("toolCall", { id: "t1", name: "create_task", args: { title: TITLE, details: DETAILS, due_in_minutes: 30 } });
  await waitFor(() => manual.toolResults.length === 1, "the tool result");
  transport.callerHangup();
  await session.done;
  return { organizationId, callId, person, result: manual.toolResults[0]?.result, events: await eventsOf(app, callId) };
}

const followUpsOf = (organizationId: string) =>
  withSystem(app, (q) => q.many("select call_id, caller_e164, title, details, owner_user_id, status from follow_ups where organization_id = $1", [organizationId]));

describe("create_task numa ligação", { timeout: 120_000 }, () => {
  it("abre a pendência com o dono configurado no agente e o telefone de quem ligou, e o tool_called não leva o texto", async () => {
    const { organizationId, callId, person, result, events } = await scene("follow-up-call", ["create_task"]);

    expect(result).toMatchObject({ ok: true });
    expect(await followUpsOf(organizationId)).toEqual([{ call_id: callId, caller_e164: CALLER, title: TITLE, details: DETAILS, owner_user_id: person, status: "open" }]);
    const called = events.find((event) => event.kind === "tool_called");
    expect(called?.payload).toEqual({ name: "create_task", args: { omitted: "personal_text" } });
    expect(events.find((event) => event.kind === "follow_up_created")?.payload).toEqual({ followUpId: expect.any(String), ownerUserId: person, dueAt: expect.any(String), status: "open" });
    const timeline = JSON.stringify(events);
    expect(timeline).not.toContain("Maria");
    expect(timeline).not.toContain("orçamento");
  });

  it("com a ferramenta fora da lista do agente: recusa, não abre pendência, e o tool_called também não leva o texto", async () => {
    const { organizationId, result, events } = await scene("follow-up-call-disabled", []);

    expect(result).toMatchObject({ ok: false });
    expect(await followUpsOf(organizationId)).toEqual([]);
    expect(events.find((event) => event.kind === "tool_called")?.payload).toEqual({ name: "create_task", args: { omitted: "personal_text" } });
    expect(JSON.stringify(events)).not.toContain("Maria");
  });
});
