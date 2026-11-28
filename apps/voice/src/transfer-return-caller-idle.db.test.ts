// A junção da transferência com volta (Vapi · fatia 5a) com o "ainda está aí?" (fatia 9), DESA-356 e
// DESA-367: a conversa e o Asterisk juntos, com a ARI falsa. Enquanto a linha toca, quem ligou está
// calado porque espera, e não porque sumiu: a guarda não pode perguntar nem encerrar. Se ela agisse aos
// 28 s, o fim viraria o da transferência (`transferred`) no meio dos 45 s de toque, e o NOANSWER não
// teria mais conversa para onde voltar. No trecho de volta, a guarda é nova e conta do zero.
import { withSystem } from "@deskvoice/core";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import type { AudioSocketCloseReason, AudioSocketConnection } from "./audiosocket";
import { AsteriskCalls } from "./asterisk-transport";
import { IDLE_ASK, IDLE_END_MS, IDLE_FIRST_MS, IDLE_SECOND_MS } from "./caller-idle";
import { startCallSession } from "./call-session";
import { callOf, createAgent, createCall, createOrganization, createTrunk, eventsOf, fakeAri, kindsOf, manualEngine, sessionHarness, type SessionHarness } from "./testing/db";
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

const DESTINO = "+5531988887777";
const VOLTA = "3b9d6c1e-2f4a-4c8b-9e7d-1a0f5c3b2d64";
/** O toque: mais que os 28 s da guarda (10 + 10 + 8), menos que os 45 s do `Dial`. */
const TOQUE_MS = 40_000;

function conexao(id: string): AudioSocketConnection & { closedLocally: boolean } {
  const closes: Array<(reason: AudioSocketCloseReason) => void> = [];
  const connection: AudioSocketConnection & { closedLocally: boolean } = {
    closedLocally: false,
    id,
    onAudio: () => undefined,
    onDtmf: () => undefined,
    onClose: (handler) => void closes.push(handler),
    sendAudio: () => undefined,
    clearAudio: () => undefined,
    spokenMs: () => 0,
    sendTone: () => Promise.resolve(),
    drained: async () => undefined,
    close: () => {
      connection.closedLocally = true;
      for (const handler of closes.splice(0)) handler("local");
    },
  };
  return connection;
}

async function cenario(label: string) {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { engine: "manual", greeting: "Bom dia.", transferTo: DESTINO, tools: ["transfer_to_human"] });
  const trunkId = await createTrunk(app, organizationId);
  await harness?.approvals.close();
  const manual = manualEngine({ keyless: true });
  harness = await sessionHarness(app, [manual.engine]);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now());
  await withSystem(app, (q) => q.exec("update calls set from_e164 = '+5531999998888', to_e164 = '+553130000099' where id = $1", [callId]));
  const ari = fakeAri();
  const calls = new AsteriskCalls({ ari, db: app, clock: harness.clock, log: () => undefined, schedule: harness.timers.schedule, newAudioId: () => VOLTA });
  const channelId = `channel-${label}`;
  calls.expect({ callId, channelId, organizationId, agentId, trunkId });
  const audio = conexao(callId);
  const attached = calls.attach(audio);
  if (!attached) throw new Error("not attached");
  const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport: attached.transport });
  await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
  return { callId, channelId, calls, audio, session, manual, harness };
}

/** Avança o relógio e dispara, em rodadas, tudo o que estiver agendado até lá: o que um prazo agenda ao vencer também vence. */
function passa(timers: SessionHarness["timers"], clock: SessionHarness["clock"], ms: number): void {
  clock.advance(ms);
  for (let round = 0; round < 6; round++) for (const delay of new Set(timers.held())) if (delay <= ms) timers.fire(delay);
}

describe("transferência com volta e o \"ainda está aí?\"", { timeout: 120_000 }, () => {
  it("40 s tocando sem atender: a guarda não pergunta nem encerra, o NOANSWER volta ao agente, e no trecho de volta ela conta do zero", async () => {
    const { callId, channelId, calls, audio, session, manual, harness } = await cenario("idle-while-ringing");
    let done = false;
    void session.done.then(() => (done = true));

    // O agente fala (a guarda passa a valer) e pede a pessoa.
    manual.emit("audio", Buffer.alloc(320));
    manual.emit("toolCall", { id: "t-transfer", name: "transfer_to_human", args: { reason: "quer falar com o financeiro", summary: "Segunda via do boleto." } });
    await waitFor(() => audio.closedLocally, "the audio to close for the transfer");
    await calls.afterAudio(channelId);
    // A ferramenta terminou durante a discagem: o `toolFinished` dela não pode rearmar a guarda.
    await waitFor(async () => (await kindsOf(app, callId)).includes("transfer_started"), "the transfer to start");
    await new Promise((resolve) => setImmediate(resolve));

    passa(harness.timers, harness.clock, TOQUE_MS);
    await new Promise((resolve) => setImmediate(resolve));
    expect(manual.said).not.toContain(IDLE_ASK["pt-BR"]);
    expect(await kindsOf(app, callId)).not.toContain("caller_idle");
    expect(await kindsOf(app, callId)).not.toContain("call_ended");
    expect(await callOf(app, callId)).toMatchObject({ status: "in_progress" });
    expect(done).toBe(false);

    // Ninguém atendeu: o canal volta, e o trecho de volta abre com um motor novo.
    await calls.transferEnded(channelId, "NOANSWER");
    expect(calls.resume(conexao(VOLTA))).toBe(true);
    await waitFor(() => manual.configs.length === 2, "the return leg to open");
    await waitFor(async () => (await kindsOf(app, callId)).includes("transfer_returned"), "the return to be recorded");
    // Antes da primeira fala do agente no trecho de volta, a guarda nova não conta nada.
    expect(harness.timers.held().filter((delay) => delay >= IDLE_FIRST_MS && delay < TOQUE_MS)).toEqual([]);

    // O agente fala no trecho de volta; a pessoa fica calada: as três ações vêm nos prazos de uma guarda nova.
    manual.emitOn(1, "audio", Buffer.alloc(320));
    // O prazo inteiro, contado do fim dos 20 ms desta fala: nada do toque foi herdado.
    expect(harness.timers.held()).toContain(20 + IDLE_FIRST_MS);
    harness.clock.advance(20 + IDLE_FIRST_MS);
    expect(harness.timers.fire(20 + IDLE_FIRST_MS)).toBe(1);
    expect(manual.said.filter((text) => text === IDLE_ASK["pt-BR"])).toHaveLength(1);
    harness.clock.advance(IDLE_SECOND_MS);
    expect(harness.timers.fire(IDLE_SECOND_MS)).toBe(1);
    harness.clock.advance(IDLE_END_MS);
    expect(harness.timers.fire(IDLE_END_MS)).toBe(1);
    // A despedida toca, e a ligação cai depois dela.
    expect(harness.timers.fire(6000)).toBe(1);
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_silent" });
    const events = await eventsOf(app, callId);
    expect(events.filter((event) => event.kind === "caller_idle").map((event) => event.payload)).toEqual([
      { action: "asked", silentMs: IDLE_FIRST_MS },
      { action: "asked_again", silentMs: IDLE_FIRST_MS + IDLE_SECOND_MS },
      { action: "ended", silentMs: IDLE_FIRST_MS + IDLE_SECOND_MS + IDLE_END_MS },
    ]);
    const kinds = events.map((event) => event.kind);
    // As ações da guarda são todas do trecho de volta, depois do `transfer_returned`.
    expect(kinds.indexOf("caller_idle")).toBeGreaterThan(kinds.indexOf("transfer_returned"));
    expect(kinds.filter((kind) => kind === "call_ended")).toHaveLength(1);
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "caller_silent" });
  });
});
