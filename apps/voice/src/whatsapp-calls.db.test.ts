// A ligação recebida pelo WhatsApp, de ponta a ponta no processo de voz: um WaCalls falso (HTTP, SSE
// e um par WebRTC de verdade no papel do dele, com o canal `pcm` a 16 kHz), o motor nas mãos do
// teste e o banco real.
import { encryptSecret, INBOUND_LIMIT_SETTING, whatsappCallsWanted, withSystem } from "@deskvoice/core";
import { afterAll, afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting } from "../../../packages/tools/test/helpers";
import type { CallSession } from "./call-session";
import { silentLogger } from "./log";
import { callOf, callsOf, createAgent, createOrganization, createPhoneNumber, createTrunk, eventsOf, kindsOf, manualEngine, secretKey, sessionHarness, type ManualEngine, type SessionHarness } from "./testing/db";
import { LOOPBACK_PEER, startFakeWacalls, type FakeCall } from "./testing/fake-wacalls";
import { manualTime, waitFor } from "./testing/helpers";
import { answerByMenu, createIvrMenu } from "./testing/ivr";
import { failureTone } from "./transport";
import { unavailableNotice } from "./unavailable";
import { wacallsSessionName } from "./wacalls-client";
import { createWhatsAppCalls, type WhatsAppCalls } from "./whatsapp-calls";

const { app, owner } = openTestDbs();
const wacalls = await startFakeWacalls();
afterAll(async () => {
  await wacalls.stop();
  await app.close();
  await owner.close();
});

const NUMBER = "+553133330000";
const CALLER = "+5531988887777";

let engine: ManualEngine;
let harness: SessionHarness;
let time: ReturnType<typeof manualTime>;
let channel: WhatsAppCalls;
let sessions: CallSession[];
beforeEach(async () => {
  wacalls.requests.length = 0;
  wacalls.state.refuseAccept = false;
  engine = manualEngine();
  harness = await sessionHarness(app, [engine.engine]);
  time = manualTime();
  sessions = [];
  channel = createWhatsAppCalls(wacalls.options, {
    schedule: time.schedule,
    log: silentLogger,
    answer: { db: app, clock: harness.clock, now: time.now, session: harness.deps, onSession: (session) => void sessions.push(session), peerConfig: LOOPBACK_PEER },
  });
  channel.listen();
  await waitFor(() => wacalls.streams() >= 1, "the events stream");
});
afterEach(async () => {
  for (const session of sessions) session.stop("test_over");
  // A fala que ainda estiver na fila só sai com o relógio da cadência andando.
  let over = false;
  void Promise.all(sessions.map((session) => session.done)).then(() => (over = true));
  await pump(() => over, "the calls to end");
  channel.close();
  await harness.approvals.close();
  // Ligação que ficou tocando no falso apareceria no retrato da conexão do próximo teste, e o
  // processo a atenderia (é o que ele faz com a que tocou com a escuta caída).
  for (const call of wacalls.calls.values()) wacalls.hangUp(call);
  // A escuta parada não reage a mais nada (`listenWacalls` ignora o que chegar depois de `stop`); o
  // falso derruba o que sobrar aberto, para o próximo teste contar só a dele.
  wacalls.dropStreams();
});

/** Uma organização com o número conectado no WaCalls e, se pedido, o agente que atende. */
async function connected(label: string, options: { agent?: "none" | "disabled"; key?: boolean; transferTo?: string; tools?: string[] } = {}) {
  const organizationId = await createOrganization(app, label);
  const agentId = options.agent === "none" ? null : await createAgent(app, organizationId, { engine: "manual", enabled: options.agent !== "disabled", greeting: "Clínica Bem Viver, bom dia.", transferTo: options.transferTo ?? null, tools: options.tools });
  if (options.key !== false) await putSetting(app, organizationId, "engine.manual.api_key", encryptSecret("sk-teste", secretKey));
  await withSystem(app, (q) =>
    q.exec("insert into whatsapp_call_sessions (organization_id, session_name, service_wanted, status, phone_e164, agent_id) values ($1, $2, true, 'connected', $3, $4)", [
      organizationId,
      wacallsSessionName(organizationId),
      NUMBER,
      agentId,
    ]),
  );
  const session = wacalls.paired(wacallsSessionName(organizationId), NUMBER.slice(1));
  return { organizationId, agentId, ring: (peer = `${CALLER.slice(1)}@s.whatsapp.net`, peerPhone?: string) => wacalls.ring(session, peer, peerPhone) };
}

const callPaths = (call: FakeCall): string[] =>
  wacalls.requests.filter((request) => request.path.split("/")[5] === call.id).map((request) => `${request.method} ${request.path.split("/")[6] ?? call.id}`);
/** Anda o relógio da cadência até a condição valer: cada passo é um pedaço de 20 ms. */
const pump = <T>(probe: () => T | Promise<T>, what: string) =>
  waitFor(async () => {
    time.advance(20);
    return probe();
  }, what);
/** Derruba o SSE e espera a volta, que traz o `call-list`. */
async function reconnect(): Promise<void> {
  wacalls.dropStreams();
  await waitFor(() => {
    time.advance(1000);
    return wacalls.streams() >= 1;
  }, "the events stream back");
}
const answeredCall = async (organizationId: string) => (await waitFor(async () => (await callsOf(app, organizationId)).find((call) => call.status === "in_progress"), "the call in progress")).id;

describe("ligação pelo WhatsApp: entrada e atendimento", { timeout: 60_000 }, () => {
  it("atende na hora: troca o SDP e atende com um dono próprio da chamada, e a conversa abre com o aviso e a saudação", async () => {
    const { organizationId, agentId, ring } = await connected("wa-answer");
    const call = ring();
    const callId = await answeredCall(organizationId);
    const clientId = `deskvoice-call-${callId}`;
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept"]);
    expect(call.offers).toEqual([clientId]);
    expect(call.owner).toBe(clientId);
    expect(await callOf(app, callId)).toMatchObject({ direction: "inbound", channel: "whatsapp", agent_id: agentId, from_e164: CALLER, to_e164: NUMBER, engine: "manual" });
    // A chamada vira `in_progress` antes de a sessão gravar o aviso: espera os três primeiros eventos.
    const opening = await waitFor(async () => {
      const events = await eventsOf(app, callId);
      return events.length >= 3 ? events.slice(0, 3) : null;
    }, "the first three events");
    expect(opening).toEqual([
      { kind: "call_started", payload: { direction: "inbound", from: CALLER, to: NUMBER, agentId, channel: "whatsapp" } },
      { kind: "call_answered", payload: { engine: "manual" } },
      { kind: "recording_notice", payload: { text: expect.any(String) } },
    ]);
    expect(engine.configs[0]?.greeting).toMatch(/^Esta ligação .* Clínica Bem Viver, bom dia\.$/);
  });

  it("a fala do agente só sai depois de o áudio com o WhatsApp ficar de pé, a 16 kHz; a voz de quem ligou chega ao motor a 8 kHz", async () => {
    const { organizationId, ring } = await connected("wa-audio");
    const call = ring();
    await answeredCall(organizationId);
    engine.emit("audio", Buffer.alloc(3200, 1));
    time.advance(1000);
    expect(call.leg?.received ?? []).toEqual([]);
    wacalls.connectMedia(call);
    await pump(() => (call.leg?.received.length ?? 0) >= 12, "the greeting and some silence");
    const frames = call.leg?.received ?? [];
    expect(frames.every((frame) => frame.length === 640)).toBe(true);
    expect(frames.slice(0, 10).every((frame) => frame.some((byte) => byte !== 0))).toBe(true);
    expect(frames[11]?.every((byte) => byte === 0)).toBe(true);

    // Quem ligou não disse nada nesses 240 ms: o motor recebeu silêncio, e o detector de turno anda.
    const silence = engine.audioBytes;
    expect(silence).toBeGreaterThan(0);
    // Sem o relógio andar, nenhum silêncio novo: o que chega agora é só a voz.
    wacalls.speak(call, Buffer.alloc(1920, 2));
    await waitFor(() => engine.audioBytes - silence === 960, "the caller audio at 8 kHz");
  });

  it("quem ligou desliga: a chamada fecha como desligada por quem ligou, sem mandar desligar de novo no WaCalls", async () => {
    const { organizationId, ring } = await connected("wa-caller-hangup");
    const call = ring();
    const callId = await answeredCall(organizationId);
    wacalls.connectMedia(call);
    wacalls.hangUp(call);
    await waitFor(async () => (await callOf(app, callId)).status === "completed", "the call to close");
    expect(await callOf(app, callId)).toMatchObject({ end_reason: "caller_hangup" });
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept"]);
  });

  it("o agente encerra (tempo máximo): a despedida sai, e só então a ligação é desligada no WaCalls", async () => {
    const { organizationId, ring } = await connected("wa-agent-ends");
    const call = ring();
    const callId = await answeredCall(organizationId);
    wacalls.connectMedia(call);
    expect(harness.timers.fire(600_000)).toBe(1);
    expect(engine.said.at(-1)).toMatch(/tempo máximo/);
    harness.timers.fire(6000);
    await pump(() => call.status === "ended", "the DELETE");
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept", `DELETE ${call.id}`]);
    await waitFor(async () => (await callOf(app, callId)).status === "completed", "the call to close");
    expect(await callOf(app, callId)).toMatchObject({ end_reason: "max_duration" });
  });

  it("transferir não existe neste canal: o motor nem recebe a ferramenta, e chamá-la assim mesmo não transfere", async () => {
    const { organizationId, ring } = await connected("wa-transfer", { transferTo: "+5531977776666", tools: ["transfer_to_human", "notify_human"] });
    ring();
    const callId = await answeredCall(organizationId);
    expect(engine.configs.at(-1)?.tools.map((tool) => tool.name)).toEqual(["notify_human"]);
    engine.emit("toolCall", { id: "t1", name: "transfer_to_human", args: { reason: "pediu uma pessoa", summary: "Quer falar com a recepção." } });
    await waitFor(() => engine.toolResults.length === 1, "the tool result");
    expect(engine.toolResults[0]?.result).toMatchObject({ ok: false });
    expect(await kindsOf(app, callId)).not.toContain("transfer_started");
  });

  it("o motor cai no meio: quem ligou ouve o sinal de falha, o painel recebe o aviso, e a ligação é desligada, sem transferência", async () => {
    const { organizationId, ring } = await connected("wa-engine-drops", { transferTo: "+5531977776666" });
    const call = ring();
    const callId = await answeredCall(organizationId);
    wacalls.connectMedia(call);
    engine.emit("closed", "provider_error");
    await pump(() => call.status === "ended", "the DELETE");
    const tone = Buffer.concat(call.leg?.received ?? []).filter((byte) => byte !== 0).length;
    expect(tone).toBeGreaterThan(failureTone().filter((byte) => byte !== 0).length);
    await waitFor(async () => (await callOf(app, callId)).status === "failed", "the call to close");
    expect(await callOf(app, callId)).toMatchObject({ end_reason: "engine_failed" });
    expect(await kindsOf(app, callId)).not.toContain("transfer_started");
    expect((await notificationsOf(app, organizationId)).at(-1)?.body).toMatch(/caiu no meio.*foi encerrada/);
  });

  it("motor sem chave: atende, quem ligou ouve o sinal de falha e a ligação cai; o painel recebe o aviso", async () => {
    const { organizationId, ring } = await connected("wa-no-key", { key: false });
    const call = ring();
    await waitFor(() => call.owner !== null, "the accept");
    wacalls.connectMedia(call);
    await pump(() => call.status === "ended", "the DELETE");
    expect(Buffer.concat(call.leg?.received ?? []).some((byte) => byte !== 0)).toBe(true);
    const [refused] = await callsOf(app, organizationId);
    expect(refused).toMatchObject({ status: "refused", end_reason: "engine_not_configured" });
    expect((await notificationsOf(app, organizationId))[0]?.body).toMatch(/não está pronto/);
  });

  it("o WaCalls recusa o atendimento: a chamada fecha como falha, o painel é avisado, e nada é desligado no WaCalls", async () => {
    const { organizationId, ring } = await connected("wa-accept-refused");
    wacalls.state.refuseAccept = true;
    const call = ring();
    const [failed] = await waitFor(async () => {
      const calls = await callsOf(app, organizationId);
      return calls[0]?.status === "failed" ? calls : null;
    }, "the failed call");
    expect(failed).toMatchObject({ end_reason: "whatsapp_answer_failed" });
    expect(await kindsOf(app, failed?.id ?? "")).toEqual(["call_ended"]);
    expect((await notificationsOf(app, organizationId))[0]?.body).toMatch(/não pôde ser atendida.*continuou tocando no celular/);
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept"]);

    // O WaCalls gravou o nosso dono antes de falhar; o retrato seguinte não a desliga. A sobra de
    // outro processo, no mesmo retrato, mostra que ele foi lido.
    expect(call.owner).toMatch(/^deskvoice-call-/);
    const session = wacalls.byName(wacallsSessionName(organizationId));
    if (!session) throw new Error("no WaCalls session");
    const leftover = wacalls.answeredBy(session, "deskvoice-call-00000000-0000-0000-0000-000000000000");
    await reconnect();
    await waitFor(() => leftover.status === "ended", "the leftover call ended");
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept"]);
    expect(call.status).toBe("ringing");
    wacalls.hangUp(call);
  });
});

describe("ligação pelo WhatsApp: quando o agente não atende, ela segue tocando no celular", { timeout: 60_000 }, () => {
  /** Recusada: linha, evento e aviso, e nenhum pedido ao WaCalls para aquela ligação. */
  async function refusedBy(organizationId: string, call: FakeCall) {
    const [refused] = await waitFor(async () => {
      const calls = (await callsOf(app, organizationId)).filter((row) => row.status === "refused");
      return calls.length > 0 ? calls : null;
    }, "the refused call");
    expect(callPaths(call)).toEqual([]);
    expect(call.status).toBe("ringing");
    return { refused, events: await eventsOf(app, refused?.id ?? ""), notices: await notificationsOf(app, organizationId) };
  }

  it("celular que o WhatsApp manda sem o nono dígito fica gravado com ele", async () => {
    const { organizationId, ring } = await connected("wa-ninth-digit", { agent: "none" });
    const { refused } = await refusedBy(organizationId, ring("553188887777:28@s.whatsapp.net"));
    expect(refused).toMatchObject({ from_e164: CALLER });
  });

  it("número oculto: vale o telefone que a oferta informa, com o nono dígito", async () => {
    const { organizationId, ring } = await connected("wa-peer-phone", { agent: "none" });
    const { refused } = await refusedBy(organizationId, ring("62440234549366:28@lid", "553188887777@s.whatsapp.net"));
    expect(refused).toMatchObject({ from_e164: CALLER });
  });

  it("número oculto sem telefone informado continua não identificado", async () => {
    const { organizationId, ring } = await connected("wa-lid-only", { agent: "none" });
    const { refused } = await refusedBy(organizationId, ring("62440234549366:28@lid"));
    expect(refused).toMatchObject({ from_e164: null });
  });

  it("sem agente escolhido", async () => {
    const { organizationId, ring } = await connected("wa-no-agent", { agent: "none" });
    const { refused, events, notices } = await refusedBy(organizationId, ring());
    expect(refused).toMatchObject({ end_reason: "no_agent", from_e164: CALLER, to_e164: NUMBER });
    expect(events).toEqual([{ kind: "call_refused", payload: { reason: "no_agent", from: CALLER, to: NUMBER, channel: "whatsapp" } }]);
    expect(notices[0]?.body).toMatch(/nenhum agente atende.*continuou tocando no celular.*Configurações/);
  });

  it("agente desligado", async () => {
    const { organizationId, ring } = await connected("wa-agent-off", { agent: "disabled" });
    const { refused, notices } = await refusedBy(organizationId, ring());
    expect(refused).toMatchObject({ end_reason: "agent_disabled" });
    expect(notices[0]?.body).toMatch(/agente desse número está desligado/);
  });

  it("teto de recebidas: a ligação da operadora em andamento conta, no mesmo teto", async () => {
    const { organizationId, agentId, ring } = await connected("wa-limit");
    await putSetting(app, organizationId, INBOUND_LIMIT_SETTING, 1, false);
    await withSystem(app, (q) =>
      q.exec("insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, started_at) values ($1, $2, 'inbound', 'whatsapp', '+5531911112222', '+553144445555', 'in_progress', $3)", [
        organizationId,
        agentId,
        harness.clock.now(),
      ]),
    );
    const { refused, events, notices } = await refusedBy(organizationId, ring());
    expect(refused).toMatchObject({ end_reason: "inbound_limit_reached" });
    expect(events[0]?.payload).toMatchObject({ reason: "inbound_limit_reached", channel: "whatsapp", limit: 1 });
    expect(notices[0]?.body).toMatch(/já havia 1 ligações recebidas em andamento, pela operadora e pelo WhatsApp/);
  });

  it("teto de recebidas: a ligação do WhatsApp em andamento ocupa a vaga da seguinte", async () => {
    const { organizationId, ring } = await connected("wa-limit-two");
    await putSetting(app, organizationId, INBOUND_LIMIT_SETTING, 1, false);
    const first = ring();
    await answeredCall(organizationId);
    const second = ring();
    await refusedBy(organizationId, second);
    expect(callPaths(first)).toEqual(["POST webrtc", "POST accept"]);
  });
});

describe("ligação pelo WhatsApp: organização suspensa", { timeout: 60_000 }, () => {
  it("atende pelo mesmo transporte só para a fala de indisponível, e desliga, sem abrir o motor; a outra organização segue atendendo", async () => {
    const suspended = await connected("wa-suspended");
    const active = await connected("wa-suspended-other");
    await withSystem(app, (q) => q.exec("update organizations set suspended_at = now(), suspended_reason = 'teste da fatia 4a' where id = $1", [suspended.organizationId]));

    const call = suspended.ring();
    const [refused] = await waitFor(async () => {
      const rows = await callsOf(app, suspended.organizationId);
      return rows.length > 0 ? rows : null;
    }, "the refused call");
    expect(refused).toMatchObject({ status: "refused", end_reason: "organization_suspended", agent_id: suspended.agentId, from_e164: CALLER, to_e164: NUMBER });
    expect(await eventsOf(app, refused?.id ?? "")).toEqual([{ kind: "call_refused", payload: { reason: "organization_suspended", from: CALLER, to: NUMBER, channel: "whatsapp" } }]);

    // Atende com um dono próprio, como a conversa; a fala só sai com o áudio de pé, e depois dela, desliga.
    await waitFor(() => call.status === "connected" || callPaths(call).includes("POST accept"), "the call to be answered");
    wacalls.connectMedia(call);
    await pump(() => call.status === "ended", "the DELETE after the notice");
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept", `DELETE ${call.id}`]);
    const notice = await unavailableNotice("pt-BR");
    const received = Buffer.concat(call.leg?.received ?? []);
    // A 16 kHz, o dobro de bytes da fala a 8 kHz; o que passa disso é o silêncio entre as falas.
    expect(received.length).toBeGreaterThanOrEqual(notice.length * 2 - 640);
    expect(received.some((byte) => byte !== 0)).toBe(true);

    // Nenhum motor, nenhum aviso, e a chamada continua como nasceu.
    expect(engine.configs).toEqual([]);
    expect(await notificationsOf(app, suspended.organizationId)).toEqual([]);
    expect(await callOf(app, refused?.id ?? "")).toMatchObject({ status: "refused", end_reason: "organization_suspended", channel: "whatsapp", engine: null });

    // A outra organização, no mesmo processo: o agente atende, com o motor.
    const other = active.ring();
    await answeredCall(active.organizationId);
    expect(engine.configs).toHaveLength(1);
    wacalls.connectMedia(other);
  });
});

// O teto de gasto do mês (R8, fatia 7c): a mesma recusa da organização suspensa, com `spend_cap_reached`,
// o teto no evento e um aviso no painel. As outras três portas estão em `spend-cap.db.test.ts`.
describe("ligação pelo WhatsApp: teto de gasto do mês", { timeout: 60_000 }, () => {
  /** Gasto no mês do relógio do teste, numa chamada antiga da organização. */
  async function spent(organizationId: string, microcents: number): Promise<void> {
    const at = new Date(harness.clock.now().getTime() - 3_600_000);
    await withSystem(app, async (q) => {
      const old = await q.one<{ id: string }>("insert into calls (organization_id, direction, channel, status, started_at, ended_at) values ($1, 'inbound', 'simulated', 'completed', $2, $2) returning id", [organizationId, at]);
      await q.exec("insert into usage_ledger (organization_id, call_id, engine, cost_cents, cost_microcents, at) values ($1, $2, 'simulated', round($3::numeric / 1000000)::int, $3, $4)", [organizationId, old?.id, microcents, at]);
    });
  }
  const capAt = (organizationId: string, cents: number) =>
    withSystem(app, (q) => q.exec("insert into organization_limits (organization_id, monthly_spend_cap_cents) values ($1, $2)", [organizationId, cents]));

  it("T1: sem teto, o agente atende mesmo com gasto alto no mês", async () => {
    const free = await connected("wa-cap-none");
    await spent(free.organizationId, 9_000_000_000);
    const call = free.ring();
    await answeredCall(free.organizationId);
    expect(engine.configs).toHaveLength(1);
    wacalls.connectMedia(call);
  });

  it("T2: no teto, atende só para a fala de indisponível e desliga, sem motor, com o evento e um aviso; 1 microcentavo a menos, o agente atende", async () => {
    const capped = await connected("wa-cap");
    await capAt(capped.organizationId, 100);
    await spent(capped.organizationId, 99_999_999);
    const first = capped.ring();
    await answeredCall(capped.organizationId);
    expect(engine.configs).toHaveLength(1);
    wacalls.connectMedia(first);

    await spent(capped.organizationId, 1);
    const call = capped.ring();
    const refused = await waitFor(async () => (await callsOf(app, capped.organizationId)).find((row) => row.status === "refused"), "the refused call");
    expect(refused).toMatchObject({ end_reason: "spend_cap_reached", agent_id: capped.agentId, from_e164: CALLER, to_e164: NUMBER });
    expect(await eventsOf(app, refused.id)).toEqual([{ kind: "call_refused", payload: { reason: "spend_cap_reached", capCents: 100, from: CALLER, to: NUMBER, channel: "whatsapp" } }]);
    await waitFor(() => call.status === "connected" || callPaths(call).includes("POST accept"), "the call to be answered");
    wacalls.connectMedia(call);
    await pump(() => call.status === "ended", "the DELETE after the notice");
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept", `DELETE ${call.id}`]);
    expect(engine.configs).toHaveLength(1);
    const notices = (await notificationsOf(app, capped.organizationId)).filter((notice) => notice.channel === "panel");
    expect(notices).toEqual([expect.objectContaining({ call_id: refused.id })]);
    expect(notices[0]?.body).toMatch(/teto de gasto do mês, de US\$ 1\.00.*aproximado/);
    expect(await callOf(app, refused.id)).toMatchObject({ status: "refused", end_reason: "spend_cap_reached", channel: "whatsapp", engine: null });
  });
  it("duas recusas pelo teto em 10 minutos, com um aviso de simultâneas antes: um aviso do teto só", async () => {
    // Sonda W1 do Verificador 2 (DESA-213): cai com o aviso pelo `end_reason` genérico (o de simultâneas
    // calaria o do teto: 0 avisos) e com o aviso sem janela (2 avisos).
    const capped = await connected("wa-cap-window");
    await capAt(capped.organizationId, 0);
    const before = new Date(harness.clock.now().getTime() - 60_000);
    await withSystem(app, async (q) => {
      const busy = await q.one<{ id: string }>(
        "insert into calls (organization_id, direction, channel, status, end_reason, started_at, ended_at) values ($1, 'inbound', 'whatsapp', 'refused', 'inbound_limit_reached', $2, $2) returning id",
        [capped.organizationId, before],
      );
      await q.exec("insert into notifications (organization_id, call_id, channel, target, body, created_at) values ($1, $2, 'panel', null, 'ocupado', $3)", [capped.organizationId, busy?.id, before]);
    });
    for (let n = 1; n <= 2; n += 1) {
      const call = capped.ring();
      await waitFor(async () => (await callsOf(app, capped.organizationId)).filter((row) => row.end_reason === "spend_cap_reached").length === n, `refusal ${n}`);
      await waitFor(() => call.status === "connected" || callPaths(call).includes("POST accept"), "the call to be answered");
      wacalls.connectMedia(call);
      await pump(() => call.status === "ended", "the DELETE after the notice");
    }
    const notices = (await notificationsOf(app, capped.organizationId)).filter((notice) => notice.channel === "panel" && /teto de gasto/.test(notice.body));
    expect(notices).toHaveLength(1);
    expect(engine.configs).toHaveLength(0);
  });

  it("suspensa e no teto: a recusa é `organization_suspended`, sem o aviso do teto", async () => {
    // Sonda W2 do Verificador 2 (DESA-213): cai com o teto conferido antes da suspensão.
    const capped = await connected("wa-cap-suspended");
    await capAt(capped.organizationId, 0);
    await withSystem(app, (q) => q.exec("update organizations set suspended_at = now(), suspended_reason = 'teste' where id = $1", [capped.organizationId]));
    const call = capped.ring();
    const refused = await waitFor(async () => (await callsOf(app, capped.organizationId)).find((row) => row.status === "refused"), "the refused call");
    await waitFor(() => call.status === "connected" || callPaths(call).includes("POST accept"), "the call to be answered");
    wacalls.connectMedia(call);
    await pump(() => call.status === "ended", "the DELETE after the notice");
    expect(refused.end_reason).toBe("organization_suspended");
    expect((await notificationsOf(app, capped.organizationId)).filter((notice) => notice.channel === "panel")).toEqual([]);
  });
});

describe("ligação pelo WhatsApp: a partida do processo de voz", { timeout: 60_000 }, () => {
  it("diz que alguma organização pediu o serviço, para o processo ouvir o WaCalls desde a partida", async () => {
    await connected("wa-wanted");
    expect(await whatsappCallsWanted(app)).toBe(true);
  });
});

describe("ligação pelo WhatsApp: a que sobrou de um processo de voz anterior", { timeout: 60_000 }, () => {
  it("na volta do SSE, desliga no WaCalls a que um processo anterior atendeu; a deste processo e a de outro dono seguem", async () => {
    const { organizationId, ring } = await connected("wa-sobra");
    const session = wacalls.byName(wacallsSessionName(organizationId));
    if (!session) throw new Error("no WaCalls session");
    const own = ring();
    await answeredCall(organizationId);
    const leftover = wacalls.answeredBy(session, "deskvoice-call-00000000-0000-0000-0000-000000000000");
    const human = wacalls.answeredBy(session, "recepcao-no-navegador");

    await reconnect();
    await waitFor(() => leftover.status === "ended", "the leftover call ended");

    expect(callPaths(leftover)).toEqual([`DELETE ${leftover.id}`]);
    expect(callPaths(human)).toEqual([]);
    expect(callPaths(own).filter((path) => path.startsWith("DELETE"))).toEqual([]);
    expect(own.status).not.toBe("ended");
    wacalls.hangUp(human);
  });
});

describe("ligação pelo WhatsApp: a que tocou com a escuta caída", { timeout: 60_000 }, () => {
  const sessionOf = (organizationId: string) => {
    const session = wacalls.byName(wacallsSessionName(organizationId));
    if (!session) throw new Error("no WaCalls session");
    return session;
  };
  const leftover = (organizationId: string) => wacalls.answeredBy(sessionOf(organizationId), "deskvoice-call-00000000-0000-0000-0000-000000000000");

  it("o retrato de cada mudança não a atende; o da volta do SSE, sim", async () => {
    const { organizationId } = await connected("wa-tocou");
    const quiet = wacalls.ringQuietly(sessionOf(organizationId), `${CALLER.slice(1)}@s.whatsapp.net`);

    // A sobra no mesmo retrato mostra que ele foi lido.
    const first = leftover(organizationId);
    wacalls.broadcastCallList();
    await waitFor(() => first.status === "ended", "the leftover call ended");
    expect(callPaths(quiet)).toEqual([]);

    await reconnect();
    await answeredCall(organizationId);
    expect(callPaths(quiet)).toEqual(["POST webrtc", "POST accept"]);
    expect(await callsOf(app, organizationId)).toMatchObject([{ from_e164: CALLER, status: "in_progress" }]);
  });

  it("a recusada segue tocando e não é recusada de novo quando o retrato da volta a mostra", async () => {
    const { organizationId, ring } = await connected("wa-tocou-recusada", { agent: "none" });
    const call = ring();
    await waitFor(async () => (await callsOf(app, organizationId))[0]?.status === "refused", "the refused call");

    const second = leftover(organizationId);
    await reconnect();
    await waitFor(() => second.status === "ended", "the leftover call ended");
    expect(await callsOf(app, organizationId)).toHaveLength(1);
    expect(callPaths(call)).toEqual([]);
  });
});

describe("ligação pelo WhatsApp: o menu por teclas fica de fora (T9 da URA, #223)", { timeout: 60_000 }, () => {
  it("a organização com um número da operadora em `ivr` atende o WhatsApp pelo agente do WhatsApp, como sempre", async () => {
    const { organizationId, agentId, ring } = await connected("wa-ivr-number");
    const trunkId = await createTrunk(app, organizationId);
    const phoneNumberId = await createPhoneNumber(app, organizationId, trunkId, "+553133339090", agentId);
    const menuId = await createIvrMenu(app, organizationId, { options: [{ digit: "1", label: "Pessoa", action: "transfer", transferE164: "+5531977776666" }] });
    await answerByMenu(app, phoneNumberId, menuId);

    ring();
    const callId = await answeredCall(organizationId);
    expect(await callOf(app, callId)).toMatchObject({ channel: "whatsapp", agent_id: agentId, engine: "manual" });
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the agent to answer");
    expect((await kindsOf(app, callId)).filter((kind) => kind.startsWith("ivr_"))).toEqual([]);
    expect(engine.configs).toHaveLength(1);
  });
});

// A exclusão de organização (R8, fatia 9b2): quem liga no meio dela, ou depois, sempre ouve a fala.
describe("ligação pelo WhatsApp: organização excluída", { timeout: 60_000 }, () => {
  /** Os pedidos ao falso sobre a sessão, em ordem, com a ligação e a sessão pelo nome. */
  const sessionPaths = (sessionId: string, call: FakeCall): string[] =>
    wacalls.requests
      .filter((request) => request.path.split("/")[3] === sessionId)
      .map((request) => {
        const [, , , , kind, id, action] = request.path.split("/");
        if (kind === "calls") return `${request.method} ${action ?? (id === call.id ? "call" : id)}`;
        return `${request.method} ${kind ?? "session"}`;
      });

  it("F1: com a lápide gravada (suspensa, deleting_at), a ligação nasce recusada como organization_suspended, ouve a fala e desliga", async () => {
    const deleting = await connected("wa-deleting");
    await withSystem(app, (q) =>
      q.exec("update organizations set suspended_at = now(), suspended_reason = 'teste da 9b2', deleting_at = now(), deleting_reason = 'teste da 9b2' where id = $1", [deleting.organizationId]),
    );
    // Sem lápide para trás, nem se o teste cair: o processo de voz de outro arquivo a desfaria.
    onTestFinished(async () => void (await withSystem(app, (q) => q.exec("delete from organizations where id = $1", [deleting.organizationId]))));
    const call = deleting.ring();
    const [refused] = await waitFor(async () => {
      const rows = await callsOf(app, deleting.organizationId);
      return rows.length > 0 ? rows : null;
    }, "the refused call");
    expect(refused).toMatchObject({ status: "refused", end_reason: "organization_suspended" });
    await waitFor(() => callPaths(call).includes("POST accept"), "the call to be answered");
    wacalls.connectMedia(call);
    await pump(() => call.status === "ended", "the DELETE after the notice");
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept", `DELETE ${call.id}`]);
    expect(Buffer.concat(call.leg?.received ?? []).some((byte) => byte !== 0)).toBe(true);
    expect(engine.configs).toEqual([]);
  });

  it("F2: a organização já apagada: atende, toca a fala no idioma padrão, desliga, não grava em calls, registra sem telefone e despareia depois da fala", async () => {
    const gone = await connected("wa-deleted");
    const sessionId = wacalls.byName(wacallsSessionName(gone.organizationId))?.id ?? "";
    // A cascata passou, e a sessão ficou viva no WaCalls.
    await withSystem(app, (q) => q.exec("delete from organizations where id = $1", [gone.organizationId]));
    const before = await withSystem(app, (q) => q.one<{ n: number }>("select count(*)::int as n from calls"));

    const call = gone.ring();
    await waitFor(() => callPaths(call).includes("POST accept"), "the call to be answered");
    expect(call.owner).toMatch(/^deskvoice-call-[0-9a-f-]{36}$/);
    wacalls.connectMedia(call);
    await pump(() => call.status === "ended", "the DELETE after the notice");
    await waitFor(() => !wacalls.sessions.has(sessionId), "the session to be unpaired");

    // A fala inteira, no idioma padrão, antes de desligar; e só depois o logout e o delete da sessão.
    const notice = await unavailableNotice("pt-BR");
    expect(Buffer.concat(call.leg?.received ?? []).length).toBeGreaterThanOrEqual(notice.length * 2 - 640);
    expect(sessionPaths(sessionId, call)).toEqual(["POST webrtc", "POST accept", "DELETE call", "POST logout", "DELETE session"]);
    expect(engine.configs).toEqual([]);

    // Nenhuma linha nova em `calls`, e o registro da instalação sem número nem id do WaCalls.
    expect(await withSystem(app, (q) => q.one<{ n: number }>("select count(*)::int as n from calls"))).toEqual(before);
    const events = await withSystem(app, (q) =>
      q.many<{ organization_id: string | null; payload: Record<string, unknown>; text: string }>(
        "select organization_id, payload, payload::text as text from installation_events where kind = 'call_to_deleted_organization' and payload->>'organization_id' = $1",
        [gone.organizationId],
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ organization_id: null, payload: { organization_id: gone.organizationId, channel: "whatsapp" } });
    for (const forbidden of [CALLER.slice(1), CALLER.slice(3), NUMBER.slice(1), NUMBER.slice(3), sessionId, call.id]) expect(events[0]?.text).not.toContain(`"${forbidden}`);
    expect(events[0]?.text).not.toMatch(/\d{8,}/);
  });
});
