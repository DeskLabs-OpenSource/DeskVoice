// A nota nascida numa ligação de verdade (sessão, motor nas mãos do teste, banco real): o telefone vem
// da chamada, e o texto que o modelo mandou não fica na linha do tempo, nem quando a ferramenta não
// está habilitada para o agente (fatia 3 do desenho de 13/11).
import { withSystem } from "@deskvoice/core";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
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

const NOTE = "Prefere ser atendida de manhã; o pedido é o PED-4471-Q.";
const CALLER = "+5531999990043";

async function scene(label: string, tools: string[]) {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { engine: "manual", tools });
  const manual = manualEngine({ keyless: true });
  harness = await sessionHarness(app, [manual.engine]);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now());
  await withSystem(app, (q) => q.exec("update calls set from_e164 = $2 where id = $1", [callId, CALLER]));
  const transport = manualTransport();
  const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport });
  await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
  manual.emit("toolCall", { id: "t1", name: "remember_caller_note", args: { text: NOTE } });
  await waitFor(() => manual.toolResults.length === 1, "the tool result");
  transport.callerHangup();
  await session.done;
  return { organizationId, callId, result: manual.toolResults[0]?.result, events: await eventsOf(app, callId), offered: manual.configs[0]?.tools.map((tool) => tool.name) ?? [] };
}

const notesOf = (organizationId: string) => withSystem(app, (q) => q.many("select call_id, caller_e164, text from caller_notes where organization_id = $1", [organizationId]));

describe("remember_caller_note numa ligação", { timeout: 120_000 }, () => {
  it("guarda a nota com o telefone de quem ligou, e o tool_called não leva o texto", async () => {
    const { organizationId, callId, result, events, offered } = await scene("note-call", ["remember_caller_note"]);

    expect(offered).toContain("remember_caller_note");
    expect(result).toMatchObject({ ok: true });
    expect(await notesOf(organizationId)).toEqual([{ call_id: callId, caller_e164: CALLER, text: NOTE }]);
    expect(events.find((event) => event.kind === "tool_called")?.payload).toEqual({ name: "remember_caller_note", args: { omitted: "personal_text" } });
    expect(JSON.stringify(events)).not.toMatch(/manhã|PED-4471-Q/);
  });

  it("com a ferramenta fora da lista do agente: não a oferece, recusa, não grava, e o tool_called também não leva o texto", async () => {
    const { organizationId, result, events, offered } = await scene("note-call-disabled", []);

    expect(offered).not.toContain("remember_caller_note");
    expect(result).toMatchObject({ ok: false });
    expect(await notesOf(organizationId)).toEqual([]);
    expect(events.find((event) => event.kind === "tool_called")?.payload).toEqual({ name: "remember_caller_note", args: { omitted: "personal_text" } });
    expect(JSON.stringify(events)).not.toMatch(/manhã|PED-4471-Q/);
  });
});
