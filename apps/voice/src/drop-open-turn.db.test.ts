// A vez aberta no instante em que quem ligou desligou (desenho 2026-11-16-follow-up-da-ligacao-que-caiu,
// seção 3.1): uma sessão de verdade, com o motor nas mãos do teste e banco real. O valor precisa ser
// lido antes de `finish` soltar as ferramentas e parar a guarda: depois, tudo pareceria fechado.
import { withOrg, withSystem } from "@deskvoice/core";
import type { Tool } from "@deskvoice/tools";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { startCallSession } from "./call-session";
import { reviewCall } from "../../routines/src/routines/review_call";
import { AFTER_CLOSE_MS, AFTER_WORDS_MS, ASK_TO_REPEAT } from "./silence-guard";
import {
  createAgent,
  createCall,
  createOrganization,
  eventsOf,
  kindsOf,
  manualEngine,
  manualTransport,
  sessionHarness,
  setHandoffTargets,
  type ManualEngine,
  type ManualTransport,
  type SessionHarness,
} from "./testing/db";
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
  organizationId: string;
  callId: string;
  manual: ManualEngine;
  transport: ManualTransport;
  done: Promise<unknown>;
}

async function answered(label: string, tools: string[] = [], extra: Tool[] = [], maxCallSeconds?: number): Promise<Scene> {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { engine: "manual", tools, ...(maxCallSeconds !== undefined && { maxCallSeconds }) });
  const manual = manualEngine({ keyless: true });
  harness = await sessionHarness(app, [manual.engine]);
  for (const tool of extra) harness.deps.tools.set(tool.name, tool);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now());
  const transport = manualTransport();
  const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport });
  await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
  return { organizationId, callId, manual, transport, done: session.done };
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
    // Sem "pode repetir?" na ligação, o fato da sessão não é gravado.
    expect(ended).not.toHaveProperty("callerSpokeAfterAsk");
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

/**
 * A condição 2(c) (decisão de 17/11): quem ligou falou, esperou, ouviu o "pode repetir?" e desligou.
 * A guarda desarma ao pedir, e o `openTurn` sai `null`; a revisão conta o caso pelos eventos.
 */
describe("o desligar depois do \"pode repetir?\" (condição 2(c))", { timeout: 120_000 }, () => {
  const ask = async (label: string, mode: "off" | "task"): Promise<Scene> => {
    const s = await answered(label);
    await withSystem(app, async (q) => {
      await q.exec("update calls set from_e164 = '+5511988887777' where id = $1", [s.callId]);
      await q.exec("update agents set drop_follow_up = $2 where organization_id = $1", [s.organizationId, mode]);
    });
    s.manual.emit("callerActivity", { words: true });
    s.manual.emit("transcript", { speaker: "user", text: "Queria saber do meu pedido." });
    expect(harness?.timers.fire(AFTER_WORDS_MS)).toBe(1);
    expect(harness?.timers.fire(AFTER_CLOSE_MS)).toBe(1);
    expect(s.manual.said).toContain(ASK_TO_REPEAT);
    await waitFor(async () => (await eventsOf(app, s.callId)).some((event) => event.kind === "caller_unanswered" && event.payload.action === "asked_to_repeat"), "the request to repeat");
    return s;
  };
  const hangUpAndReview = async (s: Scene) => {
    s.transport.callerHangup();
    await s.done;
    const now = harness?.clock.now();
    if (!now) throw new Error("no harness");
    const result = await withOrg(app, s.organizationId, (q) => reviewCall(q, s.callId, now));
    const events = await eventsOf(app, s.callId);
    const followUps = await withSystem(app, (q) => q.many<{ title: string }>("select title from follow_ups where call_id = $1", [s.callId]));
    return { result, ended: events.find((event) => event.kind === "call_ended")?.payload, drops: events.filter((event) => event.kind === "drop_follow_up").map((event) => event.payload), followUps };
  };

  it("modo task: desligar sem falar de novo abre o caso 5, logo depois do pedido e depois de 20 s", async () => {
    for (const waitMs of [0, 20_000]) {
      const s = await ask(`after-ask task ${waitMs}`, "task");
      // A transcrição do próprio pedido, se o motor gravar uma: a regra aceita no máximo uma.
      s.manual.emit("transcript", { speaker: "agent", text: ASK_TO_REPEAT });
      harness?.clock.advance(waitMs);
      const r = await hangUpAndReview(s);
      expect(r.ended).toMatchObject({ reason: "caller_hangup" });
      expect(r.ended).toHaveProperty("openTurn", null);
      expect(r.ended).toHaveProperty("callerSpokeAfterAsk", false);
      expect(r.result).toBe("opened");
      expect(r.followUps).toEqual([{ title: "Retornar para +5511988887777: a ligação caiu no meio da conversa" }]);
      expect(r.drops).toEqual([{ case: "call_dropped", mode: "task", action: "task_opened", simulated: false, openTurn: "caller_waiting" }]);
      await harness?.approvals.close();
      harness = undefined;
    }
  });

  it("quem ligou fala depois do pedido: não abre nada", async () => {
    const s = await ask("after-ask spoke", "task");
    s.manual.emit("transcript", { speaker: "user", text: "Meu pedido." });
    const r = await hangUpAndReview(s);
    expect(r.result).toBe("no_case");
    expect(r.followUps).toEqual([]);
    expect(r.drops).toEqual([]);
  });

  it("dois transcript_agent depois do pedido (o agente respondeu de fato): não abre nada", async () => {
    const s = await ask("after-ask answered", "task");
    s.manual.emit("transcript", { speaker: "agent", text: ASK_TO_REPEAT });
    s.manual.emit("transcript", { speaker: "agent", text: "Encontrei o seu pedido." });
    const r = await hangUpAndReview(s);
    expect(r.result).toBe("no_case");
    expect(r.followUps).toEqual([]);
    expect(r.drops).toEqual([]);
  });

  // Decisão de 17/11, depois da 3ª reprovação do #367: "não falou mais" é o fato da sessão
  // (`callerSpokeAfterAsk`), e não a falta de `transcript_user`, que costuma se perder no desligar.
  it("words:true depois do pedido, sem transcrição, e o desligar 0,8 s depois: não abre nada", async () => {
    const s = await ask("after-ask words no transcript", "task");
    s.manual.emit("callerActivity", { words: true });
    harness?.clock.advance(800);
    const r = await hangUpAndReview(s);
    expect(r.ended).toHaveProperty("openTurn", null);
    expect(r.ended).toHaveProperty("callerSpokeAfterAsk", true);
    expect(r.result).toBe("no_case");
    expect(r.followUps).toEqual([]);
    expect(r.drops).toEqual([]);
  });

  it("a fala por cima do áudio do pedido (que a guarda ignora) também conta: não abre nada", async () => {
    const s = await ask("after-ask words over audio", "task");
    // O áudio do "pode repetir?" (0,5 s) ainda toca quando quem ligou fala: a guarda ignora o sinal.
    s.manual.emit("audio", Buffer.alloc(16 * 500));
    s.manual.emit("callerActivity", { words: true });
    // O áudio já tocou inteiro no desligar: a vez está fechada, e só o fato da sessão separa.
    harness?.clock.advance(800);
    const r = await hangUpAndReview(s);
    expect(r.ended).toHaveProperty("openTurn", null);
    expect(r.ended).toHaveProperty("callerSpokeAfterAsk", true);
    expect(r.result).toBe("no_case");
    expect(r.followUps).toEqual([]);
    expect(r.drops).toEqual([]);
  });

  it("vale o último pedido: falar depois do 1º e ficar calado depois do 2º abre o caso 5", async () => {
    const s = await ask("after-ask second ask", "task");
    s.manual.emit("callerActivity", { words: true });
    // Quem ligou falou, e o agente de novo não respondeu: a guarda pede outra vez, e o fato zera.
    expect(harness?.timers.fire(AFTER_WORDS_MS)).toBe(1);
    expect(harness?.timers.fire(AFTER_CLOSE_MS)).toBe(1);
    await waitFor(async () => (await eventsOf(app, s.callId)).filter((event) => event.kind === "caller_unanswered" && event.payload.action === "asked_to_repeat").length === 2, "the second request to repeat");
    const r = await hangUpAndReview(s);
    expect(r.ended).toHaveProperty("callerSpokeAfterAsk", false);
    expect(r.result).toBe("opened");
  });

  it("só words:false depois do pedido (ruído, sem palavras): abre o caso 5 em task", async () => {
    const s = await ask("after-ask noise only", "task");
    s.manual.emit("callerActivity", { words: false });
    harness?.clock.advance(800);
    s.manual.emit("callerActivity", { words: false });
    const r = await hangUpAndReview(s);
    expect(r.ended).toHaveProperty("openTurn", null);
    expect(r.ended).toHaveProperty("callerSpokeAfterAsk", false);
    expect(r.result).toBe("opened");
    expect(r.drops).toEqual([{ case: "call_dropped", mode: "task", action: "task_opened", simulated: false, openTurn: "caller_waiting" }]);
  });

  it("modo off: o mesmo desligar não abre nada", async () => {
    const s = await ask("after-ask off", "off");
    harness?.clock.advance(20_000);
    const r = await hangUpAndReview(s);
    expect(r.result).toBe("no_case");
    expect(r.followUps).toEqual([]);
    expect(r.drops).toEqual([]);
  });
});

/** Quem ligou falou, o agente não respondeu e a guarda pediu para repetir: o `callerSpokeAfterAsk` passa a valer `false`. */
async function askToRepeat(engine: ManualEngine, callId: string, asks = 1): Promise<void> {
  engine.emit("callerActivity", { words: true });
  engine.emit("transcript", { speaker: "user", text: "Queria saber do meu pedido." });
  expect(harness?.timers.fire(AFTER_WORDS_MS)).toBe(1);
  expect(harness?.timers.fire(AFTER_CLOSE_MS)).toBe(1);
  await waitFor(
    async () => (await eventsOf(app, callId)).filter((event) => event.kind === "caller_unanswered" && event.payload.action === "asked_to_repeat").length === asks,
    "the request to repeat",
  );
}

// Ressalva Q7 do Verificador no #367: os dois campos só existem no fim por `caller_hangup`.
describe("o \"pode repetir?\" seguido de outro fim", { timeout: 120_000 }, () => {
  const MAX_SECONDS = 45;
  const ends: [string, (s: Scene) => void][] = [
    ["engine_failed", (s) => s.manual.emit("closed", "error")],
    ["script_finished", (s) => s.manual.emit("closed", "ended")],
    [
      "max_duration",
      () => {
        expect(harness?.timers.fire(MAX_SECONDS * 1000)).toBe(1);
        // A despedida do tempo máximo e o fim dela.
        expect(harness?.timers.fire(6000)).toBe(1);
      },
    ],
  ];

  for (const [reason, end] of ends) {
    it(`${reason}: o call_ended não tem openTurn nem callerSpokeAfterAsk`, async () => {
      const s = await answered(`after-ask then ${reason}`, [], [], MAX_SECONDS);
      await askToRepeat(s.manual, s.callId);
      end(s);
      await s.done;
      const ended = await endedOf(s.callId);
      expect(ended).toMatchObject({ reason });
      expect(ended).not.toHaveProperty("openTurn");
      expect(ended).not.toHaveProperty("callerSpokeAfterAsk");
    });
  }
});

// Ressalva Q8 do Verificador no #367: vale só o sinal da sessão em curso (`current()`).
describe("callerSpokeAfterAsk numa passagem entre agentes", { timeout: 120_000 }, () => {
  async function handedOff(label: string): Promise<{ callId: string; first: ManualEngine; second: ManualEngine; transport: ManualTransport; done: Promise<unknown> }> {
    const organizationId = await createOrganization(app, label);
    const first = manualEngine({ id: "first", keyless: true });
    const second = manualEngine({ id: "second", keyless: true });
    const reception = await createAgent(app, organizationId, { name: "Recepção", engine: "first" });
    const scheduling = await createAgent(app, organizationId, { name: "Agendamento", engine: "second" });
    await setHandoffTargets(app, reception, [scheduling]);
    harness = await sessionHarness(app, [first.engine, second.engine]);
    const callId = await createCall(app, organizationId, reception, harness.clock.now());
    const transport = manualTransport();
    const session = startCallSession(harness.deps, { organizationId, callId, agentId: reception, transport });
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
    first.emit("toolCall", { id: "t1", name: "transfer_to_agent", args: { agent: "Agendamento", reason: "agenda", summary: "Quer marcar." } });
    await waitFor(async () => (await kindsOf(app, callId)).includes("agent_handoff"), "the handoff");
    expect(first.closed).toBe(1);
    return { callId, first, second, transport, done: session.done };
  }

  it("a fala que a sessão substituída ainda emite depois do pedido não marca: callerSpokeAfterAsk fica false", async () => {
    const s = await handedOff("after-ask stale leg");
    await askToRepeat(s.second, s.callId);
    // A sessão do primeiro agente já foi fechada, mas ainda emite um sinal de fala com palavras.
    s.first.emit("callerActivity", { words: true });
    s.transport.callerHangup();
    await s.done;
    const ended = await endedOf(s.callId);
    expect(ended).toMatchObject({ reason: "caller_hangup", openTurn: null, callerSpokeAfterAsk: false });
  });

  it("a mesma fala vinda da sessão em curso marca: callerSpokeAfterAsk true", async () => {
    const s = await handedOff("after-ask current leg");
    await askToRepeat(s.second, s.callId);
    s.second.emit("callerActivity", { words: true });
    s.transport.callerHangup();
    await s.done;
    expect(await endedOf(s.callId)).toMatchObject({ reason: "caller_hangup", callerSpokeAfterAsk: true });
  });
});
