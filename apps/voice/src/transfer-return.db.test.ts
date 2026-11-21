// A transferência que ninguém atende volta para o agente (Vapi · fatia 5a, DESA-345), do lado da
// conversa: o estado `transferring`, o trecho de volta e o fim que roda uma vez só em cada caminho.
import { recordingPath, withSystem } from "@deskvoice/core";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting, tasksOf } from "../../../packages/tools/test/helpers";
import { startCallSession, TRANSFER_RETURN_GREETINGS } from "./call-session";
import { approvalsOf, callOf, createAgent, createCall, createOrganization, eventsOf, kindsOf, ledgerOf, manualEngine, manualTransport, sessionHarness, type AgentOptions, type ManualEngine, type ManualTransport, type SessionHarness } from "./testing/db";
import { AFTER_CLOSE_MS, AFTER_WORDS_MS, WITHOUT_WORDS_MS } from "./silence-guard";
import { waitFor } from "./testing/helpers";
import type { TransferOptions, TransferOutcome } from "./transport";

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

const DESTINO = "+5531988887777";
const PEDIDO = { reason: "quer falar com o financeiro", summary: "Cliente quer a segunda via do boleto de outubro." };

/** O transporte do teste num canal que volta: a transferência fica pendente até o teste dizer como terminou. */
interface ReturningTransport extends ManualTransport {
  transfers: Array<{ to: string; options: TransferOptions | undefined }>;
  /** Resolve a transferência pendente, como o Asterisk faria. */
  endTransfer(outcome: TransferOutcome): void;
}

function returningTransport(): ReturningTransport {
  const base = manualTransport();
  let pending: ((outcome: TransferOutcome) => void) | undefined;
  const transport: ReturningTransport = Object.assign(base, {
    canReturnFromTransfer: true,
    transfers: [] as ReturningTransport["transfers"],
    async transfer(to: string, options?: TransferOptions): Promise<TransferOutcome | void> {
      transport.transferredTo = to;
      transport.transfers.push({ to, options });
      if (!options?.returnIfUnanswered) return;
      return new Promise<TransferOutcome>((resolve) => (pending = resolve));
    },
    endTransfer(outcome: TransferOutcome) {
      pending?.(outcome);
      pending = undefined;
    },
  });
  return transport;
}

async function scene(label: string, agent: AgentOptions = {}) {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { engine: "manual", greeting: "Bom dia.", transferTo: DESTINO, tools: ["transfer_to_human", "notify_human"], ...agent });
  await harness?.approvals.close();
  const manual = manualEngine({ keyless: true });
  harness = await sessionHarness(app, [manual.engine]);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now());
  const transport = returningTransport();
  const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport });
  await waitFor(() => manual.configs.length === 1, "the engine to open");
  await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
  return { organizationId, agentId, callId, transport, session, manual, harness };
}

/** O agente pede a transferência e o teste espera a discagem começar. */
async function askTransfer(manual: ManualEngine, transport: ReturningTransport): Promise<void> {
  manual.emit("toolCall", { id: "t-transfer", name: "transfer_to_human", args: PEDIDO });
  await waitFor(() => transport.transfers.length === 1, "the transfer to be dialed");
}

/** O que o Asterisk grava quando a ligação volta (`asterisk-transport.ts`), antes de a conversa voltar. */
async function asteriskRecordsReturn(organizationId: string, callId: string, status: string): Promise<void> {
  await withSystem(app, async (q) => {
    await q.exec("insert into call_events (organization_id, call_id, kind, payload, at) values ($1, $2, 'transfer_completed', $3, now())", [organizationId, callId, JSON.stringify({ to: DESTINO, status, answered: false })]);
    await q.exec("insert into call_events (organization_id, call_id, kind, payload, at) values ($1, $2, 'transfer_returned', $3, now())", [organizationId, callId, JSON.stringify({ status })]);
  });
}

const count = (kinds: string[], kind: string): number => kinds.filter((each) => each === kind).length;
const tasksOfKind = async (organizationId: string, kind: string) => (await tasksOf(app, organizationId)).filter((task) => task.kind === kind);
const unansweredNotices = async (organizationId: string) => (await notificationsOf(app, organizationId)).filter((notice) => notice.body.includes("retorne a ligação"));

describe("transferência com volta para o agente", { timeout: 120_000 }, () => {
  it("durante a discagem: motor fechado, sem call_ended nem tarefas, e o áudio de quem ligou não vai a lugar nenhum", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-dialing");
    manual.emit("usage", { seconds: 30 });
    await askTransfer(manual, transport);

    expect(transport.transfers[0]).toMatchObject({ to: DESTINO, options: { returnIfUnanswered: true } });
    expect(manual.closed).toBe(1);
    const kinds = await kindsOf(app, callId);
    expect(kinds).toContain("transfer_started");
    expect(kinds).not.toContain("call_ended");
    // O aviso da transferência (da ferramenta) sai; o resumo e a revisão do fim, não.
    expect((await tasksOf(app, organizationId)).map((task) => task.kind)).toEqual(["deliver_notification"]);
    expect(await callOf(app, callId)).toMatchObject({ status: "in_progress" });

    // Os 45 s de discagem: o motor não ouve nada, e o tempo não vira custo.
    const before = manual.audioBytes;
    transport.callerAudio(45_000, 3000);
    (harness as SessionHarness).clock.advance(45_000);
    expect(manual.audioBytes).toBe(before);
    expect((await ledgerOf(app, callId)).map((row) => row.seconds)).toEqual([30]);

    await asteriskRecordsReturn(organizationId, callId, "NOANSWER");
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => manual.configs.length === 2, "the return leg to open");
    // O trecho de volta ouve quem ligou.
    transport.callerAudio(100, 3000);
    expect(manual.audioBytes).toBeGreaterThan(before);
    transport.callerHangup();
    await session.done;
    expect((await ledgerOf(app, callId)).reduce((sum, row) => sum + row.seconds, 0)).toBe(30);
  });

  it("ninguém atendeu: o trecho de volta abre com a saudação fixa, sem transfer_to_human, e com o motivo e o resumo", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-noanswer");
    await askTransfer(manual, transport);
    await asteriskRecordsReturn(organizationId, callId, "NOANSWER");
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => manual.configs.length === 2, "the return leg to open");

    const back = manual.configs[1];
    expect(back?.greeting).toBe(TRANSFER_RETURN_GREETINGS["pt-BR"]);
    expect(back?.tools.map((tool) => tool.name)).toEqual(["notify_human"]);
    expect(back?.instructions).toContain("não foi atendida (NOANSWER)");
    expect(back?.instructions).toContain("Não tente transferir de novo");
    expect(back?.instructions).toContain(PEDIDO.reason);
    expect(back?.instructions).toContain(PEDIDO.summary);
    expect(manual.configs[0]?.tools.map((tool) => tool.name)).toContain("transfer_to_human");

    // O agente deixa o recado: alguém ficou com o próximo passo, e o aviso "retorne a ligação" não sai.
    manual.emitOn(1, "toolCall", { id: "t-notify", name: "notify_human", args: { message: "Ligar de volta para a segunda via do boleto.", urgency: "normal" } });
    await waitFor(() => manual.toolResults.some((each) => each.id === "t-notify"), "the notice to be sent");
    transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });

    const kinds = await kindsOf(app, callId);
    expect(count(kinds, "call_ended")).toBe(1);
    expect(await tasksOfKind(organizationId, "summarize_call")).toHaveLength(1);
    expect(await tasksOfKind(organizationId, "review_call")).toHaveLength(1);
    expect(await unansweredNotices(organizationId)).toEqual([]);
    // A ordem na linha do tempo: a transferência, o fim dela, a volta, e o que o agente fez depois.
    const order = kinds.filter((kind) => ["transfer_started", "transfer_completed", "transfer_returned", "human_notified", "call_ended"].includes(kind));
    expect(order.slice(-4)).toEqual(["transfer_completed", "transfer_returned", "human_notified", "call_ended"]);
  });

  it("o trecho de volta termina sem recado nem pendência: o aviso para retornar sai uma vez, dizendo que voltou", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-no-follow-up");
    await askTransfer(manual, transport);
    await asteriskRecordsReturn(organizationId, callId, "BUSY");
    transport.endTransfer({ returned: true, status: "BUSY" });
    await waitFor(() => manual.configs.length === 2, "the return leg to open");
    transport.callerHangup();
    await session.done;

    const notices = await unansweredNotices(organizationId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.body).toContain("Ninguém atendeu a transferência para +5531988887777 (BUSY).");
    expect(notices[0]?.body).toContain("voltou para o agente");
    expect(notices[0]?.body).toContain(PEDIDO.reason);
    // O motivo é o do fim do trecho de volta: a ligação não acabou na transferência.
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup" });
    expect(count(await kindsOf(app, callId), "call_ended")).toBe(1);
  });

  it("atendida: o fim roda uma vez, quando a transferência termina, e a telefonia não é tocada", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-answered");
    await askTransfer(manual, transport);
    transport.endTransfer({ returned: false, status: "ANSWER" });
    expect(await session.done).toMatchObject({ status: "transferred", endReason: "transferred" });
    expect([transport.hangups, transport.closes, transport.transfers.length]).toEqual([0, 0, 1]);
    expect(manual.configs).toHaveLength(1);
    expect(count(await kindsOf(app, callId), "call_ended")).toBe(1);
    expect(await tasksOfKind(organizationId, "summarize_call")).toHaveLength(1);
    expect(await tasksOfKind(organizationId, "review_call")).toHaveLength(1);
  });

  it("quem ligou desistiu enquanto tocava: o fim roda uma vez, como desligamento, sem voltar", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-caller-hangup");
    await askTransfer(manual, transport);
    transport.endTransfer({ returned: false, status: "CALLER_HANGUP" });
    expect(await session.done).toMatchObject({ status: "transferred", endReason: "transferred" });
    expect(manual.configs).toHaveLength(1);
    expect([transport.hangups, transport.closes]).toEqual([0, 0]);
    expect(count(await kindsOf(app, callId), "call_ended")).toBe(1);
    expect(await tasksOfKind(organizationId, "summarize_call")).toHaveLength(1);
  });

  it("com a chave desligada: a ligação termina antes de transferir, como antes, e o transporte não espera volta", async () => {
    const { callId, transport, session, manual } = await scene("return-off", { transferReturnsToAgent: false });
    await askTransfer(manual, transport);
    expect(await session.done).toMatchObject({ status: "transferred", endReason: "transferred" });
    expect(transport.transfers[0]).toEqual({ to: DESTINO, options: undefined });
    expect(count(await kindsOf(app, callId), "call_ended")).toBe(1);
  });

  it("o trecho de volta não transfere de novo: nem a ferramenta, nem o teto de custo", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-no-loop", { costCeilingCents: 100 });
    await askTransfer(manual, transport);
    await asteriskRecordsReturn(organizationId, callId, "NOANSWER");
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => manual.configs.length === 2, "the return leg to open");

    // O modelo tenta a ferramenta que não recebeu: recusa, sem nova discagem.
    manual.emitOn(1, "toolCall", { id: "t-again", name: "transfer_to_human", args: PEDIDO });
    await waitFor(() => manual.toolResults.some((each) => each.id === "t-again"), "the refusal");
    expect(manual.toolResults.find((each) => each.id === "t-again")?.result).toMatchObject({ ok: false });
    // O teto chega no trecho de volta: despede e encerra, sem "vou passar você para uma pessoa".
    manual.emitOn(1, "usage", { seconds: 61 });
    await waitFor(() => manual.said.length > 0, "the farewell");
    expect(manual.said.at(-1)).not.toMatch(/passar você para uma pessoa/);
    (harness as SessionHarness).timers.fire(6000);
    expect(await session.done).toMatchObject({ status: "completed", endReason: "cost_ceiling" });
    expect(transport.transfers).toHaveLength(1);
    expect(count(await kindsOf(app, callId), "transfer_started")).toBe(1);
  });

  it("a última medição do motor que fecha passa do teto durante a discagem: nada se encerra ali, e o trecho de volta começa pela despedida", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-ceiling-while-dialing", { costCeilingCents: 100 });
    await askTransfer(manual, transport);
    manual.emitOn(0, "usage", { seconds: 61 });
    await waitFor(async () => (await ledgerOf(app, callId)).length === 1, "the last usage to be metered");
    expect(manual.said).toEqual([]);
    (harness as SessionHarness).timers.fire(6000);
    expect(await kindsOf(app, callId)).not.toContain("call_ended");

    await asteriskRecordsReturn(organizationId, callId, "NOANSWER");
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => manual.said.length > 0, "the farewell of the return leg");
    expect(manual.said.at(-1)).not.toMatch(/passar você para uma pessoa/);
    (harness as SessionHarness).timers.fire(6000);
    expect(await session.done).toMatchObject({ status: "completed", endReason: "cost_ceiling" });
    expect(transport.transfers).toHaveLength(1);
  });

  it("o motor fechado ainda avisa que acabou ou caiu durante a discagem: nada se encerra ali", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-engine-closed-while-dialing");
    await askTransfer(manual, transport);
    manual.emitOn(0, "closed", "ended");
    manual.emitOn(0, "closed", "socket_error");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await kindsOf(app, callId)).not.toContain("call_ended");
    await asteriskRecordsReturn(organizationId, callId, "NOANSWER");
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => manual.configs.length === 2, "the return leg to open");
    transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
    expect(await kindsOf(app, callId)).not.toContain("engine_failed");
  });

  it("a duração máxima conta a discagem: passada durante o Dial, o trecho de volta já começa pela despedida", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-duration", { maxCallSeconds: 60 });
    await askTransfer(manual, transport);
    (harness as SessionHarness).clock.advance(70_000);
    await asteriskRecordsReturn(organizationId, callId, "NOANSWER");
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => manual.said.some((text) => /tempo máximo/.test(text)), "the max duration farewell");
    (harness as SessionHarness).timers.fire(6000);
    expect(await session.done).toMatchObject({ status: "completed", endReason: "max_duration" });
  });

  it("o processo encerra durante a discagem: o fim é o da transferência, uma vez, e o transporte fica sabendo", async () => {
    const { callId, transport, session, manual } = await scene("return-stop");
    await askTransfer(manual, transport);
    session.stop("shutdown");
    expect(await session.done).toMatchObject({ status: "transferred", endReason: "transferred" });
    expect(transport.transfers[0]?.options?.signal?.aborted).toBe(true);
    expect([transport.hangups, transport.closes]).toEqual([0, 0]);
    expect(count(await kindsOf(app, callId), "call_ended")).toBe(1);
    // Se a discagem terminar depois, nada mais é gravado.
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(manual.configs).toHaveLength(1);
    expect(count(await kindsOf(app, callId), "call_ended")).toBe(1);
  });

  it("a guarda de silêncio fica parada durante o Dial: passado o prazo dela, nada sai (V12)", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-guard-still");
    const h = harness as SessionHarness;
    await askTransfer(manual, transport);
    // A sessão que fechou ainda manda sinal de fala (o provedor não parou de uma vez).
    manual.emitOn(0, "callerActivity", { words: true });
    manual.emitOn(0, "callerActivity", { words: false });
    for (const delay of [AFTER_WORDS_MS, WITHOUT_WORDS_MS, AFTER_CLOSE_MS]) {
      h.clock.advance(delay);
      expect(h.timers.fire(delay), `${delay}`).toBe(0);
    }
    expect(manual.callerTurnsClosed).toBe(0);
    expect(manual.said).toEqual([]);
    expect(await kindsOf(app, callId)).not.toContain("caller_unanswered");
    await asteriskRecordsReturn(organizationId, callId, "NOANSWER");
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => manual.configs.length === 2, "the return leg to open");
    transport.callerHangup();
    await session.done;
  });

  it("a duração máxima não dispara no meio do Dial (X5)", async () => {
    const { callId, transport, session, manual } = await scene("return-duration-still", { maxCallSeconds: 60 });
    const h = harness as SessionHarness;
    expect(h.timers.held()).toContain(60_000);
    await askTransfer(manual, transport);
    h.clock.advance(60_000);
    expect(h.timers.fire(60_000)).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(manual.said).toEqual([]);
    expect(await kindsOf(app, callId)).not.toContain("call_ended");
    transport.endTransfer({ returned: false, status: "ANSWER" });
    expect(await session.done).toMatchObject({ status: "transferred", endReason: "transferred" });
  });

  it("a ferramenta em espera de aprovação é solta quando a transferência começa (X10)", async () => {
    const { callId, transport, session, manual } = await scene("return-release-approval", { tools: ["transfer_to_human", "request_approval"] });
    manual.emit("toolCall", { id: "t-approval", name: "request_approval", args: { question: "Posso dar 10% de desconto?", context: "Cliente antiga." } });
    await waitFor(async () => (await approvalsOf(app, callId)).some((each) => each.status === "pending"), "the approval to wait");
    manual.emit("toolCall", { id: "t-transfer", name: "transfer_to_human", args: PEDIDO });
    // Sem soltar a espera, a discagem ficaria presa atrás da aprovação, que nunca é decidida aqui.
    await waitFor(() => transport.transfers.length === 1, "the transfer to be dialed");
    const results = (await eventsOf(app, callId)).filter((each) => each.kind === "tool_result" && each.payload.name === "request_approval");
    expect(results).toHaveLength(1);
    transport.endTransfer({ returned: false, status: "ANSWER" });
    await session.done;
  });

  it("nenhuma ferramenta roda durante a discagem (X12)", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-no-tool-while-dialing");
    await askTransfer(manual, transport);
    manual.emitOn(0, "toolCall", { id: "t-late", name: "notify_human", args: { message: "Ligar de volta.", urgency: "normal" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const kinds = await kindsOf(app, callId);
    expect(kinds).not.toContain("human_notified");
    expect(count(kinds, "tool_called")).toBe(1);
    expect(manual.toolResults.some((each) => each.id === "t-late")).toBe(false);
    await asteriskRecordsReturn(organizationId, callId, "NOANSWER");
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => manual.configs.length === 2, "the return leg to open");
    transport.callerHangup();
    await session.done;
  });

  it("um recado de antes da transferência não apaga o aviso para retornar: só conta o do trecho de volta (X9)", async () => {
    const { organizationId, callId, transport, session, manual } = await scene("return-notice-before");
    manual.emit("toolCall", { id: "t-before", name: "notify_human", args: { message: "Cliente quer falar com o financeiro.", urgency: "normal" } });
    await waitFor(() => manual.toolResults.some((each) => each.id === "t-before"), "the notice before the transfer");
    expect(await kindsOf(app, callId)).toContain("human_notified");
    await askTransfer(manual, transport);
    await asteriskRecordsReturn(organizationId, callId, "NOANSWER");
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => manual.configs.length === 2, "the return leg to open");
    transport.callerHangup();
    await session.done;
    expect(await unansweredNotices(organizationId)).toHaveLength(1);
  });

  it("quem ligou desistiu enquanto tocava: o fim sabe que quem ligou saiu, e a fala que não tocou sai da gravação (X17)", async () => {
    const organizationId = await createOrganization(app, "return-caller-gone");
    const agentId = await createAgent(app, organizationId, { engine: "manual", greeting: "Bom dia.", transferTo: DESTINO, tools: ["transfer_to_human"] });
    await putSetting(app, organizationId, "calls.recording_enabled", true, false);
    await harness?.approvals.close();
    const manual = manualEngine({ keyless: true });
    harness = await sessionHarness(app, [manual.engine]);
    const callId = await createCall(app, organizationId, agentId, harness.clock.now());
    const transport = returningTransport();
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recordings-"));
    const session = startCallSession({ ...harness.deps, recordingsDir: dir }, { organizationId, callId, agentId, transport });
    await waitFor(async () => (await kindsOf(app, callId)).includes("recording_notice"), "the notice event");
    // 20 s de fala de uma vez; tocaram 5 quando a transferência sai.
    manual.emit("audio", Buffer.alloc(20 * 8000 * 2, 1));
    harness.clock.advance(5000);
    await askTransfer(manual, transport);
    transport.endTransfer({ returned: false, status: "CALLER_HANGUP" });
    await session.done;
    const wav = await readFile(recordingPath(dir, organizationId, callId));
    expect(wav.readUInt32LE(40) / (8000 * 2 * 2)).toBeLessThan(5.5);
    await rm(dir, { recursive: true, force: true });
  });
});
