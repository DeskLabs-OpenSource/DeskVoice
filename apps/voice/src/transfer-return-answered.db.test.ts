// A transferência atendida com a volta ligada (Vapi · fatia 5a, ajuste 1, DESA-353): a conversa e o
// Asterisk juntos, com a ARI falsa. A ligação termina no `ANSWER` do `Dial`, e não quando o canal
// deixa de existir: senão ficaria `in_progress` durante toda a conversa com a pessoa da equipe,
// ocupando vaga no limite de ligações simultâneas e virando `process_restarted` num reinício.
import { INBOUND_LIMIT_SETTING, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { putSetting, tasksOf } from "../../../packages/tools/test/helpers";
import type { AudioSocketCloseReason, AudioSocketConnection } from "./audiosocket";
import { AsteriskCalls } from "./asterisk-transport";
import { startCallSession } from "./call-session";
import { inboundLimitReached } from "./inbound";
import { closeOrphanCalls } from "./reconcile";
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

async function cenario(label: string, transferReturnsToAgent = true) {
  const organizationId = await createOrganization(app, label);
  await putSetting(app, organizationId, INBOUND_LIMIT_SETTING, 1, false);
  const agentId = await createAgent(app, organizationId, { engine: "manual", greeting: "Bom dia.", transferTo: DESTINO, tools: ["transfer_to_human"], transferReturnsToAgent });
  const trunkId = await createTrunk(app, organizationId);
  await harness?.approvals.close();
  const manual = manualEngine({ keyless: true });
  harness = await sessionHarness(app, [manual.engine]);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now());
  // Recebida pela operadora, com número: é a que conta no limite de ligações simultâneas.
  await withSystem(app, (q) => q.exec("update calls set from_e164 = '+5531999998888', to_e164 = '+553130000099' where id = $1", [callId]));
  const ari = fakeAri();
  const calls = new AsteriskCalls({ ari, db: app, clock: harness.clock, log: () => undefined, schedule: harness.timers.schedule });
  const channelId = `channel-${label}`;
  calls.expect({ callId, channelId, organizationId, agentId, trunkId });
  const audio = conexao(callId);
  const attached = calls.attach(audio);
  if (!attached) throw new Error("not attached");
  const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport: attached.transport });
  await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
  const limite = () => withOrg(app, organizationId, (q) => inboundLimitReached(q, (harness as SessionHarness).clock));
  expect(await limite()).toEqual({ reached: true, limit: 1 });
  // O agente pede a transferência; o AudioSocket fecha e o canal vai discar.
  manual.emit("toolCall", { id: "t-transfer", name: "transfer_to_human", args: { reason: "quer falar com o financeiro", summary: "Segunda via do boleto." } });
  return { organizationId, callId, channelId, ari, calls, audio, session, manual, limite };
}

const count = (kinds: string[], kind: string): number => kinds.filter((each) => each === kind).length;
const tasksOfKind = async (organizationId: string, kind: string) => (await tasksOf(app, organizationId)).filter((task) => task.kind === kind);

/** O canal volta do AudioSocket para a Stasis e disca; a pessoa da equipe atende. */
async function atende(calls: AsteriskCalls, channelId: string, audio: { closedLocally: boolean }): Promise<void> {
  // O Asterisk só devolve o canal à Stasis depois de o AudioSocket fechar.
  await waitFor(() => audio.closedLocally, "the audio to close for the transfer");
  await calls.afterAudio(channelId);
  await calls.transferDialed(channelId, "ANSWER");
}

describe("transferência atendida, com a volta ligada", { timeout: 120_000 }, () => {
  it("termina no atendimento: libera a vaga, fica transferred com ended_at, e o fim roda uma vez; o ChannelDestroyed depois não soma nada (A1)", async () => {
    const { organizationId, callId, channelId, ari, calls, audio, session, limite } = await cenario("answered-ends-at-answer");
    await atende(calls, channelId, audio);
    expect(await session.done).toMatchObject({ status: "transferred", endReason: "transferred" });

    // O canal ainda está vivo, com quem ligou falando com a pessoa da equipe.
    expect(await limite()).toEqual({ reached: false, limit: 1 });
    const row = await callOf(app, callId);
    expect(row).toMatchObject({ status: "transferred", end_reason: "transferred" });
    expect(row.ended_at).not.toBeNull();
    const kinds = await kindsOf(app, callId);
    expect(count(kinds, "call_ended")).toBe(1);
    expect(count(kinds, "transfer_completed")).toBe(1);
    expect((await eventsOf(app, callId)).find((each) => each.kind === "transfer_completed")?.payload).toMatchObject({ status: "ANSWER", answered: true });
    expect(await tasksOfKind(organizationId, "summarize_call")).toHaveLength(1);
    expect(await tasksOfKind(organizationId, "review_call")).toHaveLength(1);

    // A conversa com a pessoa acaba: nada mais é gravado, e nada volta ao agente.
    const before = await eventsOf(app, callId);
    await calls.channelDestroyed(channelId, "Normal Clearing");
    await calls.transferEnded(channelId, "ANSWER");
    expect(await eventsOf(app, callId)).toEqual(before);
    expect(await tasksOfKind(organizationId, "review_call")).toHaveLength(1);
    expect(ari.log.filter((line) => line.includes("AUDIOSOCKET_UUID"))).toEqual([]);
    expect(await callOf(app, callId)).toMatchObject({ status: "transferred" });
  });

  it("o reconcile de um reinício no meio da conversa com a pessoa não toca a ligação (A2)", async () => {
    const { callId, channelId, calls, audio, session } = await cenario("answered-reconcile");
    await atende(calls, channelId, audio);
    await session.done;
    const before = await callOf(app, callId);
    const kinds = await kindsOf(app, callId);
    await closeOrphanCalls(app, (harness as SessionHarness).clock, () => undefined);
    expect(await callOf(app, callId)).toEqual(before);
    expect(await kindsOf(app, callId)).toEqual(kinds);
    expect(before).toMatchObject({ status: "transferred", end_reason: "transferred" });
  });

  it("com a chave desligada, segue como antes: a ligação termina no pedido, e a vaga também fica livre", async () => {
    const { callId, channelId, calls, session, limite } = await cenario("answered-off", false);
    expect(await session.done).toMatchObject({ status: "transferred", endReason: "transferred" });
    await calls.afterAudio(channelId);
    await calls.transferDialed(channelId, "ANSWER");
    expect(await limite()).toEqual({ reached: false, limit: 1 });
    await calls.channelDestroyed(channelId, "Normal Clearing");
    const kinds = await kindsOf(app, callId);
    expect(count(kinds, "call_ended")).toBe(1);
    expect(count(kinds, "transfer_completed")).toBe(1);
  });
});
