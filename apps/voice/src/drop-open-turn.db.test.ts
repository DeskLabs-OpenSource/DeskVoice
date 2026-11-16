// A vez aberta no instante em que quem ligou desligou (desenho 2026-11-16-follow-up-da-ligacao-que-caiu,
// seção 3.1): uma sessão de verdade, com o motor nas mãos do teste e banco real. O valor precisa ser
// lido antes de `finish` soltar as ferramentas e parar a guarda: depois, tudo pareceria fechado.
import type { Tool } from "@deskvoice/tools";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { startCallSession } from "./call-session";
import { AFTER_WORDS_MS } from "./silence-guard";
import { createAgent, createCall, createOrganization, eventsOf, kindsOf, manualEngine, manualTransport, sessionHarness, type ManualEngine, type ManualTransport, type SessionHarness } from "./testing/db";
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

/** Uma ferramenta que só termina quando o teste solta: é a "ferramenta em curso" no instante do desligar. */
function slowTool(): { tool: Tool; release(): void; started: () => boolean } {
  let release: () => void = () => undefined;
  let started = false;
  const tool: Tool = {
    name: "consulta_lenta",
    description: "Consulta que demora.",
    parameters: { type: "object", properties: {} },
    inputSchema: z.object({}),
    run: () =>
      new Promise((resolve) => {
        started = true;
        release = () => resolve({ ok: true, message: "pronto" });
      }),
  };
  return { tool, release: () => release(), started: () => started };
}

interface Scene {
  callId: string;
  manual: ManualEngine;
  transport: ManualTransport;
  done: Promise<unknown>;
}

async function answered(label: string, tools: string[] = [], extra: Tool[] = []): Promise<Scene> {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { engine: "manual", tools });
  const manual = manualEngine({ keyless: true });
  harness = await sessionHarness(app, [manual.engine]);
  for (const tool of extra) harness.deps.tools.set(tool.name, tool);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now());
  const transport = manualTransport();
  const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport });
  await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
  return { callId, manual, transport, done: session.done };
}

const endedOf = async (callId: string): Promise<Record<string, unknown> | undefined> => (await eventsOf(app, callId)).find((event) => event.kind === "call_ended")?.payload;

describe("openTurn no fim por caller_hangup", { timeout: 120_000 }, () => {
  it("vez fechada: o agente respondeu, o áudio já tocou, nada em curso → openTurn nulo, gravado", async () => {
    const s = await answered("open-turn-closed");
    s.manual.emit("callerActivity", { words: true });
    s.manual.emit("audio", Buffer.alloc(16 * 200));
    // O relógio passa do fim da fala do agente: ela já tocou inteira.
    harness?.clock.advance(1000);
    s.transport.callerHangup();
    await s.done;
    const ended = await endedOf(s.callId);
    expect(ended).toMatchObject({ reason: "caller_hangup" });
    expect(ended).toHaveProperty("openTurn", null);
  });

  it("agent_speaking: a fala do agente ainda estava tocando quando a linha caiu", async () => {
    const s = await answered("open-turn-agent");
    s.manual.emit("callerActivity", { words: true });
    // 2 s de fala chegaram e o relógio não andou: quase tudo ainda está na fila.
    s.manual.emit("audio", Buffer.alloc(16 * 2000));
    s.transport.callerHangup();
    await s.done;
    expect(await endedOf(s.callId)).toMatchObject({ reason: "caller_hangup", openTurn: "agent_speaking" });
  });

  it("o \"tchau\": quem ligou falou e desligou antes do prazo da guarda → openTurn nulo", async () => {
    const s = await answered("open-turn-goodbye");
    s.manual.emit("callerActivity", { words: true });
    s.transport.callerHangup();
    await s.done;
    const ended = await endedOf(s.callId);
    expect(ended).toMatchObject({ reason: "caller_hangup" });
    expect(ended).toHaveProperty("openTurn", null);
  });

  it("caller_waiting: quem ligou esperou além do prazo da guarda, que fechou o turno, e desligou", async () => {
    const s = await answered("open-turn-caller");
    s.manual.emit("callerActivity", { words: true });
    expect(harness?.timers.fire(AFTER_WORDS_MS)).toBe(1);
    s.transport.callerHangup();
    await s.done;
    expect(await endedOf(s.callId)).toMatchObject({ reason: "caller_hangup", openTurn: "caller_waiting" });
  });

  it("tool_running: havia ferramenta em curso, lida antes de finish soltá-la", async () => {
    const slow = slowTool();
    const s = await answered("open-turn-tool", [slow.tool.name], [slow.tool]);
    s.manual.emit("toolCall", { id: "t1", name: slow.tool.name, args: {} });
    await waitFor(() => slow.started(), "the tool to start");
    s.transport.callerHangup();
    // `finish` espera a ferramenta; ela termina depois do desligar, e o valor já tinha sido lido.
    slow.release();
    await s.done;
    expect(await endedOf(s.callId)).toMatchObject({ reason: "caller_hangup", openTurn: "tool_running" });
    // A ferramenta terminou antes de call_ended: depois de finish, nada mais estava em curso.
    const kinds = await kindsOf(app, s.callId);
    expect(kinds.indexOf("tool_result")).toBeLessThan(kinds.indexOf("call_ended"));
  });

  it("quem desliga ouvindo a despedida do end_call não deixou a vez aberta", async () => {
    const s = await answered("open-turn-farewell", ["end_call"]);
    s.manual.emit("toolCall", { id: "t1", name: "end_call", args: { reason: "a pessoa se despediu", farewell: "Até logo!" } });
    await waitFor(() => s.manual.toolResults.length === 1, "the end_call result");
    // O modelo fala a despedida, e a pessoa desliga no meio dela.
    s.manual.emit("audio", Buffer.alloc(16 * 2000));
    s.transport.callerHangup();
    await s.done;
    const ended = await endedOf(s.callId);
    expect(ended).toMatchObject({ reason: "caller_hangup" });
    expect(ended).toHaveProperty("openTurn", null);
  });
});

describe("openTurn fora do caller_hangup", { timeout: 120_000 }, () => {
  it("end_call: o campo não é gravado, mesmo com a fala do agente na fila", async () => {
    const s = await answered("open-turn-end-call", ["end_call"]);
    s.manual.emit("audio", Buffer.alloc(16 * 2000));
    s.manual.emit("toolCall", { id: "t1", name: "end_call", args: { reason: "fim" } });
    await s.done;
    const ended = await endedOf(s.callId);
    expect(ended).toMatchObject({ reason: "end_call" });
    expect(ended).not.toHaveProperty("openTurn");
  });

  it("o motor caiu: o campo não é gravado", async () => {
    const s = await answered("open-turn-engine");
    s.manual.emit("callerActivity", { words: true });
    s.manual.emit("closed", "error");
    await s.done;
    const ended = await endedOf(s.callId);
    expect(ended).toMatchObject({ reason: "engine_failed" });
    expect(ended).not.toHaveProperty("openTurn");
  });
});
