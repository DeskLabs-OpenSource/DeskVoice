// A transferência que ninguém atende volta para o agente (Vapi · fatia 5a, DESA-345), do lado do
// Asterisk, com a ARI falsa: o que se prova é o caminho do canal, e não a conversa.
import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import type { AudioSocketCloseReason, AudioSocketConnection } from "./audiosocket";
import { AsteriskCalls } from "./asterisk-transport";
import { callOf, createAgent, createCall, createOrganization, createTrunk, eventsOf, fakeAri, fakeClock, testSchedule } from "./testing/db";

const { app, owner } = openTestDbs();

afterAll(async () => {
  await app.close();
  await owner.close();
});

const DESTINO = "+5511988887777";
const VOLTA = "7f1c3a52-6a4e-4a7b-9f0e-5d2c1b0a9e88";

/** Uma conexão de AudioSocket que o teste fecha e alimenta. */
interface FakeConnection extends AudioSocketConnection {
  sent: Buffer[];
  closedLocally: boolean;
  callerAudio(pcm: Buffer): void;
  remoteClose(): void;
}

function conexao(id: string): FakeConnection {
  let audio: ((pcm: Buffer) => void) | undefined;
  const closes: Array<(reason: AudioSocketCloseReason) => void> = [];
  const connection: FakeConnection = {
    id,
    sent: [],
    closedLocally: false,
    onAudio: (handler) => void (audio = handler),
    onDtmf: () => undefined,
    onClose: (handler) => void closes.push(handler),
    sendAudio: (pcm) => void connection.sent.push(pcm),
    clearAudio: () => undefined,
    spokenMs: () => connection.sent.length * 20,
    sendTone: () => Promise.resolve(),
    drained: async () => undefined,
    close: () => {
      connection.closedLocally = true;
      for (const handler of closes.splice(0)) handler("local");
    },
    callerAudio: (pcm) => audio?.(pcm),
    remoteClose: () => {
      for (const handler of closes.splice(0)) handler("hangup");
    },
  };
  return connection;
}

async function cenario(label: string) {
  const org = await createOrganization(app, label);
  const agentId = await createAgent(app, org);
  const trunkId = await createTrunk(app, org);
  const callId = await createCall(app, org, agentId, fakeClock().now());
  await withSystem(app, (q) =>
    q.exec("insert into call_events (organization_id, call_id, kind, payload, at) values ($1, $2, 'transfer_started', $3, now())", [
      org,
      callId,
      JSON.stringify({ to: DESTINO, reason: "quer falar com o financeiro", summary: "Segunda via do boleto." }),
    ]),
  );
  const ari = fakeAri();
  const timers = testSchedule();
  const calls = new AsteriskCalls({ ari, db: app, clock: fakeClock(), log: () => undefined, schedule: timers.schedule, newAudioId: () => VOLTA });
  const channelId = `channel-${label}`;
  calls.expect({ callId, channelId, organizationId: org, agentId, trunkId });
  const first = conexao(callId);
  const attached = calls.attach(first);
  if (!attached) throw new Error("not attached");
  const { transport } = attached;
  const avisos = () => withSystem(app, (q) => q.many<{ body: string }>("select body from notifications where call_id = $1", [callId]));
  return { org, callId, channelId, ari, calls, first, transport, timers, avisos };
}

const hangups = (log: string[]) => log.filter((line) => line.startsWith("hangup"));

describe("transferência com volta, do lado do Asterisk", () => {
  it("NOANSWER: o canal ganha o AUDIOSOCKET_UUID novo e volta para deskvoice-audio; o áudio passa para a conexão nova", async () => {
    const { callId, channelId, ari, calls, first, transport, avisos } = await cenario("asterisk-return-noanswer");
    const heard: Buffer[] = [];
    transport.onAudio((pcm) => heard.push(pcm));
    let hungUp = 0;
    transport.onHangup(() => (hungUp += 1));
    transport.sendAudio(Buffer.alloc(320));

    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true });
    await calls.afterAudio(channelId);
    expect(first.closedLocally).toBe(true);
    expect(ari.log).toContain(`continue ${channelId} deskvoice-transfer,s`);
    await calls.transferEnded(channelId, "NOANSWER");

    expect(ari.log.slice(-2)).toEqual([`set ${channelId} AUDIOSOCKET_UUID=${VOLTA}`, `continue ${channelId} deskvoice-audio,s`]);
    expect(hangups(ari.log)).toEqual([]);
    // Pedida a volta, a linha do tempo ainda não diz que voltou: só quando o áudio reconectar (ajuste 2).
    const events = await eventsOf(app, callId);
    expect(events.at(-1)).toEqual(expect.objectContaining({ kind: "transfer_completed", payload: expect.objectContaining({ status: "NOANSWER", answered: false }) }));
    expect(events.map((event) => event.kind)).not.toContain("transfer_returned");
    // O aviso "retorne a ligação" fica para o fim do trecho de volta, e o motivo do fim não muda aqui.
    expect(await avisos()).toEqual([]);
    expect((await callOf(app, callId)).end_reason).not.toBe("transfer_unanswered");

    // Um AudioSocket com outro id não é a volta; com o da volta, é.
    expect(calls.resume(conexao("00000000-0000-4000-8000-000000000000"))).toBe(false);
    const second = conexao(VOLTA);
    expect(calls.resume(second)).toBe(true);
    expect(calls.attach(conexao(VOLTA))).toBeNull();
    expect(await outcome).toEqual({ returned: true, status: "NOANSWER" });
    expect((await eventsOf(app, callId)).at(-1)).toEqual({ kind: "transfer_returned", payload: { status: "NOANSWER" } });

    // O transporte agora fala e ouve pela conexão nova, e o que tocou antes continua somado.
    transport.sendAudio(Buffer.alloc(320));
    expect([first.sent.length, second.sent.length, transport.playedMs?.()]).toEqual([1, 1, 40]);
    second.callerAudio(Buffer.alloc(320, 1));
    expect(heard).toHaveLength(1);
    second.remoteClose();
    expect(hungUp).toBe(1);

    // O fim do trecho de volta desliga, e não transfere de novo.
    await calls.afterAudio(channelId);
    expect(hangups(ari.log)).toEqual([`hangup ${channelId}`]);
    expect(ari.log.filter((line) => line.includes("deskvoice-transfer"))).toHaveLength(1);
  });

  it.each(["BUSY", "CONGESTION", "CHANUNAVAIL"])("%s também volta", async (status) => {
    const { channelId, ari, calls, transport } = await cenario(`asterisk-return-${status.toLowerCase()}`);
    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true });
    await calls.afterAudio(channelId);
    await calls.transferEnded(channelId, status);
    expect(ari.log).toContain(`continue ${channelId} deskvoice-audio,s`);
    expect(calls.resume(conexao(VOLTA))).toBe(true);
    expect(await outcome).toEqual({ returned: true, status });
  });

  it.each(["INVALIDARGS", "DONTCALL", ""])("outro estado (%j) não volta: desliga como antes", async (status) => {
    const { channelId, ari, calls, transport } = await cenario(`asterisk-return-other-${status.toLowerCase() || "empty"}`);
    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true });
    await calls.afterAudio(channelId);
    await calls.transferEnded(channelId, status);
    expect(ari.log.filter((line) => line.includes("AUDIOSOCKET_UUID"))).toEqual([]);
    expect(hangups(ari.log)).toEqual([`hangup ${channelId}`]);
    expect(await outcome).toEqual({ returned: false, status: status || "UNKNOWN" });
  });

  it("o AudioSocket reconecta antes de a volta ser gravada: a conversa só volta com transfer_returned na linha do tempo", async () => {
    const { callId, channelId, ari, calls, transport } = await cenario("asterisk-return-early-socket");
    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true });
    await calls.afterAudio(channelId);
    // O Asterisk reconecta no mesmo instante do `continue`, antes de qualquer gravação.
    const resumed: boolean[] = [];
    const continueDialplan = ari.continueDialplan;
    ari.continueDialplan = async (id, context, extension) => {
      await continueDialplan(id, context, extension);
      if (context === "deskvoice-audio") resumed.push(calls.resume(conexao(VOLTA)));
    };
    const ending = calls.transferEnded(channelId, "NOANSWER");
    const seen = await outcome.then(() => eventsOf(app, callId));
    expect(resumed).toEqual([true]);
    expect(seen.map((event) => event.kind)).toContain("transfer_returned");
    await ending;
  });

  it("CALLER_HANGUP: quem ligou desistiu enquanto tocava; não volta, e o aviso sai como antes", async () => {
    const { callId, channelId, ari, calls, transport, avisos } = await cenario("asterisk-return-caller-hangup");
    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true });
    await calls.afterAudio(channelId);
    await calls.channelDestroyed(channelId, "Normal Clearing");
    expect(await outcome).toEqual({ returned: false, status: "CALLER_HANGUP" });
    expect(ari.log.filter((line) => line.includes("AUDIOSOCKET_UUID"))).toEqual([]);
    expect((await avisos())[0]?.body).toContain("desligou antes de a transferência");
    expect((await eventsOf(app, callId)).map((event) => event.kind)).not.toContain("transfer_returned");
  });

  it("ANSWER: a pessoa atendeu; não volta, e a espera resolve no atendimento, com o canal ainda vivo", async () => {
    const { callId, channelId, ari, calls, transport, avisos } = await cenario("asterisk-return-answer");
    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true });
    await calls.afterAudio(channelId);
    await calls.transferDialed(channelId, "ANSWER");
    expect(await outcome).toEqual({ returned: false, status: "ANSWER" });
    const answered = await eventsOf(app, callId);
    expect(answered.at(-1)).toMatchObject({ kind: "transfer_completed", payload: { status: "ANSWER", answered: true } });
    // O canal deixa de existir quando a conversa com a pessoa acaba: só se esquece o canal.
    await calls.channelDestroyed(channelId, "Normal Clearing");
    expect(await eventsOf(app, callId)).toEqual(answered);
    expect(hangups(ari.log)).toEqual([]);
    expect(ari.log.filter((line) => line.includes("AUDIOSOCKET_UUID"))).toEqual([]);
    expect(await avisos()).toEqual([]);
  });

  it("ANSWER com o ChannelDestroyed chegando enquanto o atendimento é gravado: a conversa só termina com o transfer_completed na linha do tempo", async () => {
    const { callId, channelId, calls, transport } = await cenario("asterisk-return-answer-race");
    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true });
    await calls.afterAudio(channelId);
    const dialed = calls.transferDialed(channelId, "ANSWER");
    const destroyed = calls.channelDestroyed(channelId, "Normal Clearing");
    const seen = await outcome.then(() => eventsOf(app, callId));
    expect(seen.filter((event) => event.kind === "transfer_completed")).toHaveLength(1);
    await Promise.all([dialed, destroyed]);
    expect((await eventsOf(app, callId)).filter((event) => event.kind === "transfer_completed")).toHaveLength(1);
  });

  it("ANSWER sem pedir a volta (a chave desligada): o transfer_completed sai no ChannelDestroyed, como antes", async () => {
    const { callId, channelId, calls, transport } = await cenario("asterisk-return-answer-off");
    expect(await transport.transfer(DESTINO)).toBeUndefined();
    await calls.afterAudio(channelId);
    await calls.transferDialed(channelId, "ANSWER");
    expect((await eventsOf(app, callId)).map((event) => event.kind)).not.toContain("transfer_completed");
    await calls.channelDestroyed(channelId, "Normal Clearing");
    expect((await eventsOf(app, callId)).at(-1)).toMatchObject({ kind: "transfer_completed", payload: { status: "ANSWER", answered: true } });
  });

  it("sem pedir a volta (a chave desligada): NOANSWER desliga como antes, e o transporte resolve na hora", async () => {
    const { callId, channelId, ari, calls, transport, avisos } = await cenario("asterisk-return-off");
    expect(await transport.transfer(DESTINO)).toBeUndefined();
    await calls.afterAudio(channelId);
    await calls.transferEnded(channelId, "NOANSWER");
    expect(hangups(ari.log)).toEqual([`hangup ${channelId}`]);
    expect(ari.log.filter((line) => line.includes("AUDIOSOCKET_UUID"))).toEqual([]);
    expect((await avisos())[0]?.body).toContain("retorne a ligação");
    expect(await callOf(app, callId)).toMatchObject({ end_reason: "transfer_unanswered" });
  });

  it("a conversa acabou enquanto tocava (signal): NOANSWER desliga como antes", async () => {
    const { channelId, ari, calls, transport } = await cenario("asterisk-return-aborted");
    const ended = new AbortController();
    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true, signal: ended.signal });
    await calls.afterAudio(channelId);
    ended.abort();
    await calls.transferEnded(channelId, "NOANSWER");
    expect(hangups(ari.log)).toEqual([`hangup ${channelId}`]);
    expect(await outcome).toEqual({ returned: false, status: "NOANSWER" });
  });

  it("o AudioSocket não reconecta no prazo: desliga, e a espera resolve sem volta", async () => {
    const { callId, channelId, ari, calls, transport, timers, avisos } = await cenario("asterisk-return-timeout");
    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true });
    await calls.afterAudio(channelId);
    await calls.transferEnded(channelId, "NOANSWER");
    expect(timers.fire(5000)).toBe(1);
    expect(await outcome).toEqual({ returned: false, status: "NOANSWER" });
    // Ninguém atendeu, e a ligação não voltou: o aviso sai aqui, uma vez (ajuste 2).
    expect((await avisos()).filter((aviso) => aviso.body.includes("retorne a ligação"))).toHaveLength(1);
    expect(await callOf(app, callId)).toMatchObject({ end_reason: "transfer_unanswered" });
    expect((await eventsOf(app, callId)).map((event) => event.kind)).not.toContain("transfer_returned");
    await new Promise((resolve) => setImmediate(resolve));
    expect(hangups(ari.log)).toEqual([`hangup ${channelId}`]);
    // A conexão que chegar atrasada não é mais da ligação.
    expect(calls.resume(conexao(VOLTA))).toBe(false);
  });

  it("a ARI recusa a volta: desliga como antes, com o aviso", async () => {
    const { channelId, ari, calls, transport, avisos } = await cenario("asterisk-return-ari-down");
    const outcome = transport.transfer(DESTINO, { returnIfUnanswered: true });
    await calls.afterAudio(channelId);
    ari.failing = true;
    await calls.transferEnded(channelId, "NOANSWER").catch(() => undefined);
    expect(await outcome).toEqual({ returned: false, status: "NOANSWER" });
    expect((await avisos())[0]?.body).toContain("retorne a ligação");
  });
});
