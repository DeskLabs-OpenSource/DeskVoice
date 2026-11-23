// A transferência sem atendimento que não chega a voltar (Vapi · fatia 5a, ajuste 2, DESA-355): a
// conversa e o Asterisk juntos, com a ARI falsa. Sem atendimento e sem volta, a ligação fica como não
// atendida (`transfer_unanswered`, e não `transferred`), o aviso "retorne a ligação" sai uma vez, e a
// linha do tempo não diz que a ligação voltou.
import { withSystem } from "@deskvoice/core";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { tasksOf } from "../../../packages/tools/test/helpers";
import type { AudioSocketCloseReason, AudioSocketConnection } from "./audiosocket";
import { AsteriskCalls } from "./asterisk-transport";
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
const VOLTA = "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

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
  const agentId = await createAgent(app, organizationId, { engine: "manual", greeting: "Bom dia.", transferTo: DESTINO, tools: ["transfer_to_human"], transferReturnsToAgent: true });
  const trunkId = await createTrunk(app, organizationId);
  await harness?.approvals.close();
  const manual = manualEngine({ keyless: true });
  harness = await sessionHarness(app, [manual.engine]);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now());
  const ari = fakeAri();
  const calls = new AsteriskCalls({ ari, db: app, clock: harness.clock, log: () => undefined, schedule: harness.timers.schedule, newAudioId: () => VOLTA });
  const channelId = `channel-${label}`;
  calls.expect({ callId, channelId, organizationId, agentId, trunkId });
  const audio = conexao(callId);
  const attached = calls.attach(audio);
  if (!attached) throw new Error("not attached");
  const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport: attached.transport });
  await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
  manual.emit("toolCall", { id: "t-transfer", name: "transfer_to_human", args: { reason: "quer falar com o financeiro", summary: "Segunda via do boleto." } });
  // O Asterisk só devolve o canal à Stasis depois de o AudioSocket fechar.
  await waitFor(() => audio.closedLocally, "the audio to close for the transfer");
  const timers = (harness as SessionHarness).timers;
  return { organizationId, callId, channelId, ari, calls, session, timers };
}

const count = (kinds: string[], kind: string): number => kinds.filter((each) => each === kind).length;
/** Os avisos "retorne a ligação" (o "Ligação transferida" da ferramenta sai em toda transferência, e não conta). */
const avisos = (callId: string) => withSystem(app, (q) => q.many<{ body: string }>("select body from notifications where call_id = $1 and body like '%retorne a ligação%'", [callId]));

/** Sem atendimento e sem volta: não atendida, uma vez, sem `transfer_returned`, com um aviso só. */
async function confereNaoAtendida(organizationId: string, callId: string, session: { done: Promise<unknown> }, dialStatus: string): Promise<void> {
  expect(await session.done).toMatchObject({ status: "transferred", endReason: "transfer_unanswered" });
  expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "transfer_unanswered" });
  const events = await eventsOf(app, callId);
  const kinds = events.map((each) => each.kind);
  expect(kinds).not.toContain("transfer_returned");
  expect(count(kinds, "transfer_completed")).toBe(1);
  expect(events.find((each) => each.kind === "transfer_completed")?.payload).toMatchObject({ status: dialStatus, answered: false });
  expect(count(kinds, "call_ended")).toBe(1);
  expect(events.find((each) => each.kind === "call_ended")?.payload).toMatchObject({ status: "transferred", reason: "transfer_unanswered" });
  const sent = await avisos(callId);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toContain("retorne a ligação");
  expect(sent[0]?.body).toContain(`Ninguém atendeu a transferência para ${DESTINO} (${dialStatus})`);
  expect(sent[0]?.body).not.toContain("voltou para o agente");
  const tasks = await tasksOf(app, organizationId);
  expect(tasks.filter((task) => task.kind === "review_call")).toHaveLength(1);
  expect(tasks.filter((task) => task.kind === "summarize_call")).toHaveLength(1);
}

describe("transferência sem atendimento que não volta, com a sessão", { timeout: 120_000 }, () => {
  it("a ARI recusa a volta: fica não atendida, e o aviso sai uma vez", async () => {
    const { organizationId, callId, channelId, ari, calls, session } = await cenario("failed-ari-refuses");
    await calls.afterAudio(channelId);
    ari.failing = true;
    await calls.transferEnded(channelId, "NOANSWER").catch(() => undefined);
    await confereNaoAtendida(organizationId, callId, session, "NOANSWER");
  });

  it("o estado que não volta (INVALIDARGS): fica não atendida, e o aviso sai uma vez", async () => {
    const { organizationId, callId, channelId, ari, calls, session } = await cenario("failed-other-status");
    await calls.afterAudio(channelId);
    await calls.transferEnded(channelId, "INVALIDARGS");
    expect(ari.log.filter((line) => line.includes("AUDIOSOCKET_UUID"))).toEqual([]);
    await confereNaoAtendida(organizationId, callId, session, "INVALIDARGS");
  });

  it("a discagem nem começa (FAILED): fica não atendida, e o aviso sai uma vez", async () => {
    const { organizationId, callId, channelId, ari, calls, session } = await cenario("failed-dial-failed");
    ari.failing = true;
    await calls.afterAudio(channelId).catch(() => undefined);
    await confereNaoAtendida(organizationId, callId, session, "FAILED");
  });

  it("o AudioSocket não reconecta em 5 s: fica não atendida, a linha do tempo não diz que voltou, e o aviso sai uma vez", async () => {
    const { organizationId, callId, channelId, ari, calls, session, timers } = await cenario("failed-no-reconnect");
    await calls.afterAudio(channelId);
    await calls.transferEnded(channelId, "NOANSWER");
    expect(ari.log).toContain(`continue ${channelId} deskvoice-audio,s`);
    // Pedida a volta, nada é dito ainda: nem que voltou, nem o aviso.
    expect(await kindsOf(app, callId)).not.toContain("transfer_returned");
    expect(await avisos(callId)).toEqual([]);
    expect(timers.fire(5000)).toBe(1);
    await confereNaoAtendida(organizationId, callId, session, "NOANSWER");
    await waitFor(() => ari.log.includes(`hangup ${channelId}`), "the channel to be hung up");
    // A conexão que chegar atrasada não é mais da ligação, e nada muda.
    expect(calls.resume(conexao(VOLTA))).toBe(false);
    await calls.channelDestroyed(channelId, "Normal Clearing");
    await confereNaoAtendida(organizationId, callId, session, "NOANSWER");
  });

  it("quem ligou desliga entre a volta e a reconexão: fica não atendida, e o aviso sai uma vez", async () => {
    const { organizationId, callId, channelId, calls, session } = await cenario("failed-hangup-before-reconnect");
    await calls.afterAudio(channelId);
    await calls.transferEnded(channelId, "NOANSWER");
    await calls.channelDestroyed(channelId, "Normal Clearing");
    await confereNaoAtendida(organizationId, callId, session, "NOANSWER");
    expect(calls.resume(conexao(VOLTA))).toBe(false);
  });

  it("quem ligou desliga enquanto a volta grava o transfer_completed: fica não atendida, e o aviso sai uma vez", async () => {
    // A sonda do parecer 7071769356 (R11): o desligamento chega depois do `continue deskvoice-audio` e
    // antes de a gravação do `transfer_completed` da volta terminar.
    const { organizationId, callId, channelId, ari, calls, session } = await cenario("failed-hangup-while-recording");
    await calls.afterAudio(channelId);
    const ended = calls.transferEnded(channelId, "NOANSWER");
    while (!ari.log.includes(`continue ${channelId} deskvoice-audio,s`)) await new Promise((resolve) => setImmediate(resolve));
    await calls.channelDestroyed(channelId, "Normal Clearing");
    await ended;
    await confereNaoAtendida(organizationId, callId, session, "NOANSWER");
    expect(calls.resume(conexao(VOLTA))).toBe(false);
  });

  it("quem ligou desliga enquanto o Asterisk ainda não aceitou a volta: o aviso sai uma vez, como se ainda tocasse", async () => {
    // O canal deixa de existir durante o `continue deskvoice-audio`, e a ARI então recusa a volta. É o
    // desfecho de quem desiste enquanto toca (`CALLER_HANGUP`), e não o da volta que não reconectou.
    const { organizationId, callId, channelId, ari, calls, session } = await cenario("failed-hangup-during-continue");
    await calls.afterAudio(channelId);
    let refuse: () => void = () => undefined;
    const continuing = new Promise<void>((_resolve, reject) => (refuse = () => reject(new Error("Channel not found"))));
    ari.continueDialplan = () => continuing;
    const ended = calls.transferEnded(channelId, "NOANSWER");
    while (!ari.log.some((line) => line.includes("AUDIOSOCKET_UUID"))) await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const destroyed = calls.channelDestroyed(channelId, "Normal Clearing");
    await new Promise((resolve) => setImmediate(resolve));
    refuse();
    await Promise.all([destroyed, ended]);
    expect(await session.done).toMatchObject({ status: "transferred" });
    const events = await eventsOf(app, callId);
    const kinds = events.map((each) => each.kind);
    expect(kinds).not.toContain("transfer_returned");
    expect(count(kinds, "transfer_completed")).toBe(1);
    expect(events.find((each) => each.kind === "transfer_completed")?.payload).toMatchObject({ status: "CALLER_HANGUP", answered: false });
    const sent = await avisos(callId);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain("retorne a ligação");
    const tasks = await tasksOf(app, organizationId);
    expect(tasks.filter((task) => task.kind === "review_call")).toHaveLength(1);
  });

  it("o áudio reconecta enquanto a volta grava o transfer_completed: o transfer_returned sai depois dele", async () => {
    const { callId, channelId, ari, calls, session } = await cenario("failed-resume-while-recording");
    await calls.afterAudio(channelId);
    const ended = calls.transferEnded(channelId, "NOANSWER");
    while (!ari.log.includes(`continue ${channelId} deskvoice-audio,s`)) await new Promise((resolve) => setImmediate(resolve));
    expect(calls.resume(conexao(VOLTA))).toBe(true);
    await ended;
    await waitFor(async () => (await kindsOf(app, callId)).includes("transfer_returned"), "the return to be recorded");
    const kinds = await kindsOf(app, callId);
    expect(count(kinds, "transfer_completed")).toBe(1);
    expect(count(kinds, "transfer_returned")).toBe(1);
    expect(kinds.indexOf("transfer_completed")).toBeLessThan(kinds.indexOf("transfer_returned"));
    expect(await avisos(callId)).toEqual([]);
    expect((await callOf(app, callId)).ended_at).toBeNull();
    session.stop("process_shutdown");
    await session.done;
  });

  it("o áudio reconecta: a linha do tempo diz que voltou só então, e a ligação continua sem aviso", async () => {
    const { callId, channelId, calls, session } = await cenario("failed-control-returns");
    await calls.afterAudio(channelId);
    await calls.transferEnded(channelId, "NOANSWER");
    expect(await kindsOf(app, callId)).not.toContain("transfer_returned");
    expect(calls.resume(conexao(VOLTA))).toBe(true);
    await waitFor(async () => (await kindsOf(app, callId)).includes("transfer_returned"), "the return to be recorded");
    const kinds = await kindsOf(app, callId);
    expect(kinds.indexOf("transfer_completed")).toBeLessThan(kinds.indexOf("transfer_returned"));
    expect(count(kinds, "transfer_returned")).toBe(1);
    expect(await avisos(callId)).toEqual([]);
    expect((await callOf(app, callId)).ended_at).toBeNull();
    // O trecho de volta acaba sem recado nem pendência, e o canal deixa de existir: o aviso sai uma vez,
    // o do fim do trecho de volta, e a ligação não vira não atendida.
    session.stop("process_shutdown");
    await session.done;
    await calls.channelDestroyed(channelId, "Normal Clearing");
    const sent = await avisos(callId);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain("voltou para o agente");
    expect((await callOf(app, callId)).end_reason).toBe("process_shutdown");
  });
});
