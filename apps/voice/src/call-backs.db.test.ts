// A religação da ligação que caiu, do lado do processo de voz (desenho
// 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.6, passos 3 a 5; fatia 3). A revisão agenda, a rotina
// passa a `due`, e aqui a linha vira chamada, só por `startOutboundCall`.
import {
  CALL_BACK_ATTEMPTS,
  CALL_BACK_EXPIRE_AFTER_MINUTES,
  CALL_BACK_INSTRUCTION,
  CALL_BACK_INTERVAL_MINUTES,
  CALL_BACK_MAX_ATTEMPTS,
  CALL_BACK_MIN_INTERVAL_MINUTES,
  CALL_BACK_REFUSAL_CODES,
  callBackFailedTitle,
  recordEvent,
  withOrg,
  withSystem,
  type ClaimedTask,
} from "@deskvoice/core";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import callBackRoutine from "../../routines/src/routines/call_back";
import { reviewCall } from "../../routines/src/routines/review_call";
import type { RoutineDeps } from "../../routines/src/types";
import { AsteriskCalls } from "./asterisk-transport";
import { placeCallBack, startCallBacks, type CallBacks } from "./call-backs";
import { startCallSession } from "./call-session";
import type { OutboundDeps } from "./outbound";
import {
  callOf,
  createAgent,
  createOrganization,
  createPhoneNumber,
  createTrunk,
  eventsOf,
  fakeAri,
  fakeClock,
  kindsOf,
  manualEngine,
  manualTransport,
  sessionHarness,
  type AgentOptions,
  type SessionHarness,
} from "./testing/db";
import { waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
let running: CallBacks | undefined;
let harness: SessionHarness | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
  await harness?.approvals.close();
  harness = undefined;
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

const CALLER = "+5531988887777";
const LINE = "+553133334444";
const MINUTE = 60_000;

describe("as constantes da religação (decisão de 18/11, DESA-121, pedido 1 = A)", () => {
  it("1 tentativa, 30 minutos depois; o teto é 3 e o intervalo nunca fica abaixo de 30 minutos", () => {
    expect(CALL_BACK_ATTEMPTS).toBe(1);
    expect(CALL_BACK_INTERVAL_MINUTES).toBe(30);
    expect(CALL_BACK_MAX_ATTEMPTS).toBe(3);
    expect(CALL_BACK_ATTEMPTS).toBeGreaterThanOrEqual(1);
    expect(CALL_BACK_ATTEMPTS).toBeLessThanOrEqual(CALL_BACK_MAX_ATTEMPTS);
    expect(CALL_BACK_INTERVAL_MINUTES).toBeGreaterThanOrEqual(CALL_BACK_MIN_INTERVAL_MINUTES);
  });

  it("o banco recusa a tentativa 4, mesmo que o código mude", async () => {
    const s = await scene("cb attempt cap");
    await expect(
      withOrg(app, s.organizationId, (q) =>
        q.exec("insert into call_backs (organization_id, origin_call_id, agent_id, to_e164, attempt, due_at, created_at) values ($1, $2, $3, $4, 4, $5, $5)", [s.organizationId, s.originId, s.agentId, CALLER, s.clock.now()]),
      ),
    ).rejects.toThrow(/call_backs_attempt_check/);
  });

  it("o banco aceita todo código de CALL_BACK_REFUSAL_CODES, inclusive outbound_not_allowed e spend_cap_reached, e recusa um inventado", async () => {
    const s = await scene("cb refusal codes");
    expect(CALL_BACK_REFUSAL_CODES).toContain("outbound_not_allowed");
    expect(CALL_BACK_REFUSAL_CODES).toContain("spend_cap_reached");
    const id = await withSystem(app, (q) =>
      q.one<{ id: string }>(
        "insert into call_backs (organization_id, origin_call_id, agent_id, to_e164, attempt, due_at, status, refusal_code, created_at) values ($1, $2, $3, $4, 1, $5, 'refused', 'outbound_not_allowed', $5) returning id",
        [s.organizationId, s.originId, s.agentId, CALLER, s.clock.now()],
      ),
    );
    for (const code of CALL_BACK_REFUSAL_CODES) await withSystem(app, (q) => q.exec("update call_backs set refusal_code = $2 where id = $1", [id?.id, code]));
    await expect(withSystem(app, (q) => q.exec("update call_backs set refusal_code = 'phone_on_fire' where id = $1", [id?.id]))).rejects.toThrow(/call_backs_refusal_code_check/);
  });
});

/**
 * Uma organização com a política de saída ligada (janela do dia inteiro), um agente no modo
 * `call_back` com número e linha, e uma ligação recebida e atendida de `CALLER` que caiu com a vez
 * aberta, terminada agora.
 */
async function scene(label: string, agent: AgentOptions = {}) {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, agent);
  await withSystem(app, (q) => q.exec("update agents set drop_follow_up = 'call_back' where id = $1", [agentId]));
  const trunkId = await createTrunk(app, organizationId, { callerId: LINE });
  await createPhoneNumber(app, organizationId, trunkId, LINE, agentId);
  await withSystem(app, (q) => q.exec("insert into outbound_policy (organization_id, enabled, window_start, window_end, timezone) values ($1, true, '00:00', '23:59', 'UTC')", [organizationId]));
  const ari = fakeAri();
  const clock = fakeClock();
  const calls = new AsteriskCalls({ ari, db: app, clock, log: () => undefined });
  const deps: OutboundDeps = { db: app, ari, clock, calls, log: () => undefined };
  const origin = await withSystem(app, (q) =>
    q.one<{ id: string }>(
      `insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, end_reason, started_at, ended_at)
       values ($1, $2, 'inbound', 'phone', $3, $4, 'completed', 'caller_hangup', $5, $5) returning id`,
      [organizationId, agentId, CALLER, LINE, clock.now()],
    ),
  );
  const originId = origin?.id ?? "";
  await withOrg(app, organizationId, async (q) => {
    await recordEvent(q, originId, "call_answered", { engine: "simulated" }, clock.now());
    await recordEvent(q, originId, "call_ended", { status: "completed", reason: "caller_hangup", costCents: 0, seconds: 30, openTurn: "caller_waiting" }, clock.now());
  });
  const policy = (set: string) => withSystem(app, (q) => q.exec(`update outbound_policy set ${set} where organization_id = $1`, [organizationId]));
  const review = (callId: string) => withOrg(app, organizationId, (q) => reviewCall(q, callId, clock.now()));
  const rows = () =>
    withSystem(app, (q) =>
      q.many<{ id: string; status: string; result_call_id: string | null; refusal_code: string | null; attempt: number }>(
        "select id, status, result_call_id, refusal_code, attempt from call_backs where organization_id = $1 order by attempt",
        [organizationId],
      ),
    );
  /** A revisão agenda e, 30 minutos depois, a rotina passa a linha a `due`. */
  async function due(): Promise<string> {
    expect(await review(originId)).toBe("call_back_scheduled");
    clock.advance(CALL_BACK_INTERVAL_MINUTES * MINUTE);
    const [row] = await rows();
    const routineTask: ClaimedTask = { id: crypto.randomUUID(), organizationId, callId: originId, kind: "call_back", payload: { callBackId: row?.id }, attempts: 1 };
    await callBackRoutine.run(routineTask, { db: app, clock } as unknown as RoutineDeps);
    expect((await rows())[0]?.status).toBe("due");
    return row?.id ?? "";
  }
  const place = (callBackId: string) => placeCallBack(deps, organizationId, callBackId);
  const results = async () => (await eventsOf(app, originId)).filter((event) => event.kind === "drop_follow_up_result").map((event) => event.payload);
  const followUps = () => withSystem(app, (q) => q.many<{ call_id: string | null; title: string }>("select call_id, title from follow_ups where organization_id = $1 order by created_at", [organizationId]));
  const outboundCalls = () =>
    withSystem(app, (q) =>
      q.many<{ id: string; status: string; end_reason: string | null; call_back_of: string | null; to_e164: string | null }>(
        "select id, status, end_reason, call_back_of, to_e164 from calls where organization_id = $1 and direction = 'outbound' order by started_at, id",
        [organizationId],
      ),
    );
  return { organizationId, agentId, trunkId, originId, ari, clock, calls, deps, policy, review, rows, due, place, results, followUps, outboundCalls };
}

describe("a discagem da religação", { timeout: 120_000 }, () => {
  it("o caminho inteiro: agenda, fica due, disca por startOutboundCall com call_back_of, e a não atendida abre a pendência sem nova tentativa", async () => {
    const s = await scene("cb path");
    const id = await s.due();
    await s.place(id);

    const [placed] = await s.outboundCalls();
    expect(placed).toMatchObject({ status: "ringing", call_back_of: s.originId, to_e164: CALLER });
    expect(s.ari.originated).toEqual([expect.objectContaining({ endpoint: `PJSIP/5531988887777@trunk-${s.trunkId}`, channelId: placed?.id })]);
    expect(await s.rows()).toEqual([expect.objectContaining({ status: "placed", result_call_id: placed?.id })]);
    expect(await s.results()).toEqual([{ action: "call_back_placed", attempt: 1, callId: placed?.id }]);

    // Ninguém atendeu: o canal some sem áudio. O fim enfileira a revisão, que grava o resultado na original.
    await s.calls.channelDestroyed(placed?.id ?? "", "NOANSWER");
    expect(await callOf(app, placed?.id ?? "")).toMatchObject({ status: "failed", end_reason: "no_answer" });
    expect(await kindsOf(app, placed?.id ?? "")).toEqual(["call_ended", "task_queued"]);
    expect(await s.review(placed?.id ?? "")).toBe("call_back_result");
    expect((await s.results())[1]).toEqual({ action: "call_back_not_answered", attempt: 1, callId: placed?.id, costCents: 0 });
    expect(await s.followUps()).toEqual([{ call_id: s.originId, title: callBackFailedTitle(CALLER, "not_answered") }]);
    expect(await s.rows()).toHaveLength(1);
    expect(s.ari.originated).toHaveLength(1);
  });

  // A política é conferida na hora de discar: cada uma estava em ordem no agendamento.
  const refusals: Array<[string, string, (s: Awaited<ReturnType<typeof scene>>) => Promise<unknown>]> = [
    ["a política desligada", "outbound_disabled", (s) => s.policy("enabled = false")],
    ["fora da janela", "outside_window", (s) => s.policy("window_start = '00:00', window_end = '00:01', timezone = 'Pacific/Kiritimati'")],
    [
      "o teto diário da linha",
      "daily_cap_reached",
      async (s) => {
        await s.policy("daily_cap_per_line = 1");
        await withSystem(app, (q) =>
          q.exec("insert into calls (organization_id, agent_id, direction, channel, trunk_id, from_e164, to_e164, status, started_at) values ($1, $2, 'outbound', 'phone', $3, $4, '+5531900000001', 'completed', $5)", [
            s.organizationId,
            s.agentId,
            s.trunkId,
            LINE,
            s.clock.now(),
          ]),
        );
      },
    ],
    [
      "as tentativas por pessoa esgotadas",
      "attempts_exhausted",
      async (s) => {
        await s.policy("max_attempts_per_contact = 1");
        await withSystem(app, (q) =>
          q.exec("insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, started_at) values ($1, $2, 'outbound', 'phone', $3, $4, 'completed', $5)", [
            s.organizationId,
            s.agentId,
            LINE,
            CALLER,
            new Date(s.clock.now().getTime() - 2 * 24 * 60 * MINUTE),
          ]),
        );
      },
    ],
  ];
  for (const [what, code, change] of refusals) {
    it(`${what} entre o agendamento e a hora de discar: recusada com ${code}, sem discar, e a pendência de reserva`, async () => {
      const s = await scene(`cb refused ${code}`);
      const id = await s.due();
      await change(s);
      await s.place(id);
      expect(s.ari.originated).toEqual([]);
      const refused = (await s.outboundCalls()).find((call) => call.call_back_of === s.originId);
      expect(refused).toMatchObject({ status: "refused", end_reason: code });
      expect(await kindsOf(app, refused?.id ?? "")).toEqual(["call_refused"]);
      expect(await s.rows()).toEqual([expect.objectContaining({ status: "refused", refusal_code: code, result_call_id: refused?.id })]);
      expect(await s.results()).toEqual([{ action: "call_back_refused", attempt: 1, callId: refused?.id, refusalCode: code }]);
      expect(await s.followUps()).toEqual([{ call_id: s.originId, title: callBackFailedTitle(CALLER, code as "outbound_disabled") }]);
    });
  }

  // A trava da instalação (R8, fatia 7b, ajuste 1): a religação travada é recusada pela porta única com o
  // próprio código, e nunca aparece como defeito da telefonia (`originate_failed`).
  it("a instalação trava a saída entre o agendamento e a hora de discar: outbound_not_allowed, sem discar, com a pendência e sem log de código inesperado", async () => {
    const s = await scene("cb installation lock");
    const id = await s.due();
    await withSystem(app, (q) => q.exec("insert into organization_limits (organization_id, outbound_allowed) values ($1, false)", [s.organizationId]));
    const logs: Array<{ level: string; message: string }> = [];
    await placeCallBack({ ...s.deps, log: (level, message) => void logs.push({ level, message }) }, s.organizationId, id);
    expect(s.ari.originated).toEqual([]);
    const refused = (await s.outboundCalls()).find((call) => call.call_back_of === s.originId);
    expect(refused).toMatchObject({ status: "refused", end_reason: "outbound_not_allowed" });
    expect(await s.rows()).toEqual([expect.objectContaining({ status: "refused", refusal_code: "outbound_not_allowed", result_call_id: refused?.id })]);
    expect(await s.results()).toEqual([{ action: "call_back_refused", attempt: 1, callId: refused?.id, refusalCode: "outbound_not_allowed" }]);
    const followUps = await s.followUps();
    expect(followUps).toEqual([{ call_id: s.originId, title: callBackFailedTitle(CALLER, "outbound_not_allowed") }]);
    expect(followUps[0]?.title).toContain("a administração da instalação bloqueou");
    expect(logs.filter((entry) => entry.level === "error")).toEqual([]);
  });

  // O teto de gasto do mês (R8, fatia 7c): a religação travada pelo teto é recusada pela porta única com o
  // próprio código, e nunca aparece como defeito da telefonia (`originate_failed`).
  it("T7: o teto do mês é atingido entre o agendamento e a hora de discar: spend_cap_reached, sem discar, com a pendência e sem log de código inesperado", async () => {
    const s = await scene("cb spend cap");
    const id = await s.due();
    await withSystem(app, (q) => q.exec("insert into organization_limits (organization_id, monthly_spend_cap_cents) values ($1, 0)", [s.organizationId]));
    const logs: Array<{ level: string; message: string }> = [];
    await placeCallBack({ ...s.deps, log: (level, message) => void logs.push({ level, message }) }, s.organizationId, id);
    expect(s.ari.originated).toEqual([]);
    const refused = (await s.outboundCalls()).find((call) => call.call_back_of === s.originId);
    expect(refused).toMatchObject({ status: "refused", end_reason: "spend_cap_reached" });
    expect(await s.rows()).toEqual([expect.objectContaining({ status: "refused", refusal_code: "spend_cap_reached", result_call_id: refused?.id })]);
    expect(await s.results()).toEqual([{ action: "call_back_refused", attempt: 1, callId: refused?.id, refusalCode: "spend_cap_reached" }]);
    const followUps = await s.followUps();
    expect(followUps).toEqual([{ call_id: s.originId, title: callBackFailedTitle(CALLER, "spend_cap_reached") }]);
    expect(followUps[0]?.title).toContain("teto de gasto do mês");
    expect(logs.filter((entry) => entry.level === "error")).toEqual([]);
  });

  it("o número posto na lista de não ligar entre o agendamento e a hora de discar nunca é discado, e não abre pendência", async () => {
    const s = await scene("cb do not call later");
    const id = await s.due();
    await withSystem(app, (q) => q.exec("insert into do_not_call (organization_id, e164) values ($1, $2)", [s.organizationId, CALLER]));
    await s.place(id);
    expect(s.ari.originated).toEqual([]);
    expect(await s.rows()).toEqual([expect.objectContaining({ status: "refused", refusal_code: "do_not_call" })]);
    expect(await s.results()).toEqual([expect.objectContaining({ action: "call_back_refused", refusalCode: "do_not_call" })]);
    expect(await s.followUps()).toEqual([]);
  });

  it("o agente desligado na hora de discar: recusada antes de criar a chamada, com o código e a pendência", async () => {
    const s = await scene("cb agent disabled");
    const id = await s.due();
    await withSystem(app, (q) => q.exec("update agents set enabled = false where id = $1", [s.agentId]));
    await s.place(id);
    expect(s.ari.originated).toEqual([]);
    expect(await s.outboundCalls()).toEqual([]);
    expect(await s.rows()).toEqual([expect.objectContaining({ status: "refused", refusal_code: "agent_disabled", result_call_id: null })]);
    expect(await s.results()).toEqual([{ action: "call_back_refused", attempt: 1, refusalCode: "agent_disabled" }]);
    expect(await s.followUps()).toEqual([{ call_id: s.originId, title: callBackFailedTitle(CALLER, "agent_disabled") }]);
  });

  it("a central que não origina: originate_failed, uma pendência só, e a revisão do no_answer não grava de novo", async () => {
    const s = await scene("cb originate failed");
    const id = await s.due();
    s.ari.failing = true;
    await s.place(id);
    const [failed] = await s.outboundCalls();
    expect(failed).toMatchObject({ status: "failed", end_reason: "no_answer", call_back_of: s.originId });
    expect(await s.rows()).toEqual([expect.objectContaining({ status: "refused", refusal_code: "originate_failed", result_call_id: failed?.id })]);
    expect(await s.review(failed?.id ?? "")).toBe("skipped");
    expect(await s.results()).toEqual([{ action: "call_back_refused", attempt: 1, callId: failed?.id, refusalCode: "originate_failed" }]);
    expect(await s.followUps()).toEqual([{ call_id: s.originId, title: callBackFailedTitle(CALLER, "originate_failed") }]);
  });

  it("a linha due há mais de 1 hora (voz parada) vira expired, sem discar, com a pendência", async () => {
    const s = await scene("cb expired");
    const id = await s.due();
    s.clock.advance((CALL_BACK_EXPIRE_AFTER_MINUTES + 1) * MINUTE);
    await s.place(id);
    expect(s.ari.originated).toEqual([]);
    expect(await s.outboundCalls()).toEqual([]);
    expect(await s.rows()).toEqual([expect.objectContaining({ status: "expired" })]);
    expect(await s.results()).toEqual([{ action: "call_back_expired", attempt: 1 }]);
    expect(await s.followUps()).toEqual([{ call_id: s.originId, title: callBackFailedTitle(CALLER, "expired") }]);
  });

  it("três reivindicações ao mesmo tempo (dois processos de voz): uma discagem só", async () => {
    for (let round = 0; round < 5; round++) {
      const s = await scene(`cb race ${round}`);
      const id = await s.due();
      await Promise.all([s.place(id), s.place(id), s.place(id)]);
      expect(s.ari.originated, `round ${round}`).toHaveLength(1);
      expect(await s.outboundCalls()).toHaveLength(1);
      expect(await s.results()).toHaveLength(1);
    }
  });

  it("a linha travada por outro processo é pulada na hora (skip locked), sem esperar e sem discar", async () => {
    const s = await scene("cb skip locked");
    const id = await s.due();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const other = withOrg(app, s.organizationId, async (q) => {
      await q.exec("select 1 from call_backs where id = $1 for update", [id]);
      locked();
      await held;
    });
    await isLocked;
    const outcome = await Promise.race([s.place(id).then(() => "returned"), new Promise((resolve) => setTimeout(() => resolve("waited"), 3000))]);
    release();
    await other;
    expect(outcome).toBe("returned");
    expect(s.ari.originated).toEqual([]);
    expect((await s.rows())[0]?.status).toBe("due");
    // Solta a trava, a próxima reivindicação disca.
    await s.place(id);
    expect(s.ari.originated).toHaveLength(1);
  });

  it("o processo que caiu depois de discar não disca de novo: a chamada da tentativa já existe", async () => {
    const s = await scene("cb crash");
    const id = await s.due();
    await withSystem(app, (q) =>
      q.exec("insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, started_at, call_back_of) values ($1, $2, 'outbound', 'phone', $3, $4, 'ringing', $5, $6)", [
        s.organizationId,
        s.agentId,
        LINE,
        CALLER,
        s.clock.now(),
        s.originId,
      ]),
    );
    await s.place(id);
    expect(s.ari.originated).toEqual([]);
    expect((await s.rows())[0]).toMatchObject({ status: "placed", result_call_id: (await s.outboundCalls())[0]?.id });
  });
});

describe("a escuta do canal call_backs", { timeout: 120_000 }, () => {
  it("o aviso da rotina acorda o processo de voz, que disca", async () => {
    const s = await scene("cb listen");
    running = await startCallBacks(s.deps);
    await s.due();
    await waitFor(async () => s.ari.originated.length === 1, "the call-back to be placed");
    await waitFor(async () => (await s.rows())[0]?.status === "placed", "the row to be placed");
    expect((await s.outboundCalls())[0]).toMatchObject({ call_back_of: s.originId });
  });

  it("ao subir, a varredura pega a linha que ficou due com o processo parado", async () => {
    const s = await scene("cb sweep on start");
    await s.due();
    expect(s.ari.originated).toEqual([]);
    running = await startCallBacks(s.deps);
    await waitFor(async () => s.ari.originated.length === 1, "the swept call-back to be placed");
  });
});

describe("a sessão da religação", { timeout: 120_000 }, () => {
  async function session(label: string, agent: AgentOptions, callBack: boolean) {
    const s = await scene(label, { engine: "manual", ...agent });
    const manual = manualEngine({ keyless: true, centsPerMinute: 100 });
    harness = await sessionHarness(app, [manual.engine]);
    const call = await withSystem(app, (q) =>
      q.one<{ id: string }>(
        "insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, started_at, call_back_of) values ($1, $2, 'outbound', 'phone', $3, $4, 'ringing', $5, $6) returning id",
        [s.organizationId, s.agentId, LINE, CALLER, harness?.clock.now(), callBack ? s.originId : null],
      ),
    );
    const callId = call?.id ?? "";
    const transport = manualTransport();
    const started = startCallSession(harness.deps, { organizationId: s.organizationId, callId, agentId: s.agentId, transport });
    await waitFor(async () => manual.configs.length === 1, "the engine to connect");
    return { ...s, manual, callId, transport, started };
  }

  it("soma a linha fixa às instruções, na língua do agente, e só na religação", async () => {
    const pt = await session("cb line pt", { instructions: "Você é a recepção." }, true);
    expect(pt.manual.configs[0]?.instructions).toBe(`Você é a recepção.\n\n${CALL_BACK_INSTRUCTION["pt-BR"]}`);
    pt.transport.callerHangup();
    await pt.started.done;
    await harness?.approvals.close();

    const en = await session("cb line en", { instructions: "You are the front desk.", language: "en-US" }, true);
    expect(en.manual.configs[0]?.instructions).toBe(`You are the front desk.\n\n${CALL_BACK_INSTRUCTION.en}`);
    en.transport.callerHangup();
    await en.started.done;
    await harness?.approvals.close();

    const plain = await session("cb line plain", { instructions: "Você é a recepção." }, false);
    expect(plain.manual.configs[0]?.instructions).toBe("Você é a recepção.");
    plain.transport.callerHangup();
    await plain.started.done;
  });

  it("a religação tem o teto de custo do agente e grava o próprio custo, que vai para o resultado na original", async () => {
    const s = await session("cb ceiling", { costCeilingCents: 150 }, true);
    await withSystem(app, (q) =>
      q.exec("insert into call_backs (organization_id, origin_call_id, agent_id, to_e164, attempt, due_at, status, result_call_id, created_at) values ($1, $2, $3, $4, 1, $5, 'placed', $6, $5)", [
        s.organizationId,
        s.originId,
        s.agentId,
        CALLER,
        s.clock.now(),
        s.callId,
      ]),
    );
    await waitFor(async () => (await kindsOf(app, s.callId)).includes("call_answered"), "the call to be answered");
    s.manual.emit("usage", { seconds: 90 });
    await waitFor(async () => (await kindsOf(app, s.callId)).includes("cost_ceiling_reached"), "the ceiling");
    expect(harness?.timers.fire(6000)).toBe(1);
    expect(await s.started.done).toEqual({ status: "completed", endReason: "cost_ceiling", costCents: 150 });
    expect((await callOf(app, s.callId)).cost_cents).toBe(150);
    expect(await s.review(s.callId)).toBe("call_back_result");
    expect(await s.results()).toEqual([{ action: "call_back_answered", attempt: 1, callId: s.callId, costCents: 150 }]);
    expect(await s.followUps()).toEqual([]);
  });
});
