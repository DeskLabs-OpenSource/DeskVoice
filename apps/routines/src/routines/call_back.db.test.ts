import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALL_BACK_INTERVAL_MINUTES, CALL_BACKS_CHANNEL, callBackFailedTitle, eraseCaller, listen, recordEvent, withOrg, withSystem, type CallEventKind } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, createUser, depsFor, eventsOf, openTestDbs, putSetting, putWhatsAppConnector, t0, task, tasksOf, until } from "../../test/helpers";
import callBackRoutine from "./call_back";
import { reviewCall, reviewTitle } from "./review_call";

/**
 * O modo `call_back` na revisão e a rotina `call_back` (desenho 2026-11-16-follow-up-da-ligacao-que-caiu,
 * seção 3.6, passos 1, 2 e 5; fatia 3). A discagem, que é do processo de voz, está em
 * `apps/voice/src/call-backs.db.test.ts`.
 */
const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const CALLER = "+5531988887777";
const LINE = "+553133334444";
const ENDED = new Date(t0.getTime() - 60_000);
type Ev = [CallEventKind, object];

interface Scene {
  org: string;
  agent: string;
  callId: string;
  person: string;
}

const hangup = (openTurn: string | null): Ev[] => [
  ["call_answered", { engine: "simulated" }],
  ["transcript_user", { text: "Meu nome é Joana Prado" }],
  ["call_ended", { status: "completed", reason: "caller_hangup", costCents: 0, seconds: 30, openTurn }],
];

async function organization(label: string, options: { policy?: boolean; mode?: string } = {}): Promise<{ org: string; agent: string; person: string }> {
  const org = await createOrganization(app, label);
  const person = await createUser(app, org, null);
  const agent = await withSystem(app, (q) =>
    q.one<{ id: string }>("insert into agents (organization_id, name, engine, follow_up_owner_user_id, drop_follow_up) values ($1, 'Recepção', 'simulated', $2, $3) returning id", [
      org,
      person,
      options.mode ?? "call_back",
    ]),
  );
  if (options.policy !== false) await withSystem(app, (q) => q.exec("insert into outbound_policy (organization_id, enabled) values ($1, true)", [org]));
  return { org, agent: agent?.id ?? "", person };
}

/** Uma ligação encerrada em `ENDED`, com os eventos dados. */
async function callIn(
  base: { org: string; agent: string },
  events: Ev[],
  call: { from?: string | null; channel?: string; endReason?: string; direction?: "inbound" | "outbound"; callBackOf?: string; costCents?: number; status?: string } = {},
): Promise<string> {
  const direction = call.direction ?? "inbound";
  const other = call.from === undefined ? CALLER : call.from;
  const row = await withSystem(app, (q) =>
    q.one<{ id: string }>(
      `insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, end_reason, started_at, ended_at, call_back_of, cost_cents)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [
        base.org,
        base.agent,
        direction,
        call.channel ?? "phone",
        direction === "inbound" ? other : LINE,
        direction === "outbound" ? other : LINE,
        call.status ?? "completed",
        call.endReason ?? "caller_hangup",
        new Date(ENDED.getTime() - 30_000),
        ENDED,
        call.callBackOf ?? null,
        call.costCents ?? 0,
      ],
    ),
  );
  const callId = row?.id ?? "";
  await withOrg(app, base.org, async (q) => {
    for (const [kind, payload] of events) await recordEvent(q, callId, kind, payload, ENDED);
  });
  return callId;
}

async function dropped(label: string, options: Parameters<typeof organization>[1] = {}, call: Parameters<typeof callIn>[2] = {}): Promise<Scene> {
  const base = await organization(label, options);
  return { ...base, callId: await callIn(base, hangup("caller_waiting"), call) };
}

const review = (org: string, callId: string, now = t0) => withOrg(app, org, (q) => reviewCall(q, callId, now));
const callBacksOf = (org: string) =>
  withSystem(app, (q) =>
    q.many<{ id: string; origin_call_id: string; agent_id: string | null; to_e164: string | null; attempt: number; due_at: Date; status: string; result_call_id: string | null; refusal_code: string | null }>(
      "select id, origin_call_id, agent_id, to_e164, attempt, due_at, status, result_call_id, refusal_code from call_backs where organization_id = $1 order by created_at, attempt",
      [org],
    ),
  );
const followUpsOf = (org: string) =>
  withSystem(app, (q) => q.many<{ call_id: string | null; title: string; source: string | null; owner_user_id: string | null }>("select call_id, title, source, owner_user_id from follow_ups where organization_id = $1 order by created_at", [org]));
const payloadsOf = async (callId: string, kind: CallEventKind) => (await eventsOf(app, callId)).filter((event) => event.kind === kind).map((event) => event.payload);

describe("review_call no modo call_back: o agendamento", () => {
  it("com a política ligada, agenda a tentativa 1 para o fim + 30 minutos, enfileira a rotina na mesma hora e não abre pendência", async () => {
    const s = await dropped("cb schedules");
    expect(await review(s.org, s.callId)).toBe("call_back_scheduled");
    const due = new Date(ENDED.getTime() + CALL_BACK_INTERVAL_MINUTES * 60_000);
    const rows = await callBacksOf(s.org);
    expect(rows).toEqual([expect.objectContaining({ origin_call_id: s.callId, agent_id: s.agent, to_e164: CALLER, attempt: 1, due_at: due, status: "scheduled", result_call_id: null, refusal_code: null })]);
    expect((await tasksOf(app, s.org)).filter((row) => row.kind === "call_back")).toMatchObject([{ payload: { callBackId: rows[0]?.id }, call_id: s.callId, run_at: due }]);
    expect(await payloadsOf(s.callId, "drop_follow_up")).toEqual([{ case: "call_dropped", mode: "call_back", action: "call_back_scheduled", simulated: false, openTurn: "caller_waiting" }]);
    expect(await followUpsOf(s.org)).toEqual([]);
    // Nenhum texto da conversa no evento.
    expect(JSON.stringify([await payloadsOf(s.callId, "drop_follow_up"), rows])).not.toContain("Joana");
  });

  it("repetir a revisão não agenda a segunda religação", async () => {
    const s = await dropped("cb twice");
    await review(s.org, s.callId);
    expect(await review(s.org, s.callId)).toBe("already_reviewed");
    expect(await callBacksOf(s.org)).toHaveLength(1);
    expect((await tasksOf(app, s.org)).filter((row) => row.kind === "call_back")).toHaveLength(1);
  });

  it("o caso 1 (o motor caiu numa recebida e atendida) também agenda", async () => {
    const base = await organization("cb engine failed");
    const callId = await callIn(base, [["call_answered", { engine: "simulated" }], ["engine_failed", { engine: "openai-realtime", error: "socket closed" }]], { endReason: "engine_failed", status: "failed" });
    expect(await review(base.org, callId)).toBe("call_back_scheduled");
    expect(await payloadsOf(callId, "drop_follow_up")).toEqual([{ case: "engine_failed", mode: "call_back", action: "call_back_scheduled", simulated: false, openTurn: null }]);
  });

  it("com a política de saída desligada, o modo está indisponível: skipped com mode_unavailable e a pendência", async () => {
    const s = await dropped("cb policy off", { policy: false });
    expect(await review(s.org, s.callId)).toBe("opened");
    expect(await callBacksOf(s.org)).toEqual([]);
    expect(await payloadsOf(s.callId, "drop_follow_up")).toEqual([{ case: "call_dropped", mode: "call_back", action: "skipped", reason: "mode_unavailable", simulated: false, openTurn: "caller_waiting" }]);
    expect(await followUpsOf(s.org)).toEqual([expect.objectContaining({ call_id: s.callId, title: reviewTitle(CALLER, "call_dropped"), source: "review_call", owner_user_id: s.person })]);
  });

  it("número na lista de não ligar: nada agendado e nenhuma pendência", async () => {
    const s = await dropped("cb do not call");
    await withSystem(app, (q) => q.exec("insert into do_not_call (organization_id, e164) values ($1, $2)", [s.org, CALLER]));
    expect(await review(s.org, s.callId)).toBe("do_not_call");
    expect(await callBacksOf(s.org)).toEqual([]);
    expect(await followUpsOf(s.org)).toEqual([]);
    expect(await payloadsOf(s.callId, "drop_follow_up")).toEqual([{ case: "call_dropped", mode: "call_back", action: "skipped", reason: "do_not_call", simulated: false, openTurn: "caller_waiting" }]);
  });

  it("a segunda queda do mesmo número em menos de 24 horas não agenda: recent_follow_up e a pendência", async () => {
    const s = await dropped("cb recent");
    await review(s.org, s.callId);
    const second = await callIn(s, hangup("caller_waiting"));
    expect(await review(s.org, second, new Date(t0.getTime() + 23 * 60 * 60_000))).toBe("opened");
    expect(await callBacksOf(s.org)).toHaveLength(1);
    expect(await payloadsOf(second, "drop_follow_up")).toEqual([{ case: "call_dropped", mode: "call_back", action: "skipped", reason: "recent_follow_up", simulated: false, openTurn: "caller_waiting" }]);
    expect(await followUpsOf(s.org)).toEqual([expect.objectContaining({ call_id: second, title: reviewTitle(CALLER, "call_dropped") })]);
    // Passadas as 24 horas, agenda de novo.
    const third = await callIn(s, hangup("caller_waiting"));
    expect(await review(s.org, third, new Date(t0.getTime() + 25 * 60 * 60_000))).toBe("call_back_scheduled");
  });

  it("um follow-up por número vale entre os modos: a mensagem do WhatsApp conta para a religação, e a religação para a mensagem", async () => {
    const s = await dropped("cb after message");
    await withSystem(app, (q) => q.exec("insert into notifications (organization_id, channel, audience, target, body, created_at) values ($1, 'whatsapp', 'caller', $2, 'x', $3)", [s.org, CALLER, t0]));
    expect(await review(s.org, s.callId)).toBe("opened");
    expect(await payloadsOf(s.callId, "drop_follow_up")).toMatchObject([{ action: "skipped", reason: "recent_follow_up" }]);

    const other = await dropped("cb then message");
    expect(await review(other.org, other.callId)).toBe("call_back_scheduled");
    await withSystem(app, (q) => q.exec("update agents set drop_follow_up = 'whatsapp' where organization_id = $1", [other.org]));
    await putWhatsAppConnector(app, other.org);
    await putSetting(app, other.org, "whatsapp.trust_caller_id", true, false);
    const next = await callIn(other, hangup("caller_waiting"));
    await review(other.org, next);
    expect((await payloadsOf(next, "drop_follow_up"))[0]).toMatchObject({ mode: "whatsapp", action: "skipped", reason: "recent_follow_up" });
    expect(await withSystem(app, (q) => q.many("select 1 from notifications where organization_id = $1 and audience = 'caller'", [other.org]))).toEqual([]);
  });

  it("a simulada grava o que teria acontecido e não insere nada", async () => {
    const s = await dropped("cb simulated", {}, { channel: "simulated", from: null });
    expect(await review(s.org, s.callId)).toBe("simulated");
    expect(await callBacksOf(s.org)).toEqual([]);
    expect((await tasksOf(app, s.org)).filter((row) => row.kind === "call_back")).toEqual([]);
    expect(await payloadsOf(s.callId, "drop_follow_up")).toEqual([{ case: "call_dropped", mode: "call_back", action: "call_back_scheduled", simulated: true, openTurn: "caller_waiting" }]);
  });

  it("a ligação pelo WhatsApp não é religada: cai na reserva", async () => {
    const s = await dropped("cb whatsapp channel", {}, { channel: "whatsapp" });
    expect(await review(s.org, s.callId)).toBe("opened");
    expect(await callBacksOf(s.org)).toEqual([]);
    expect(await payloadsOf(s.callId, "drop_follow_up")).toMatchObject([{ action: "skipped", reason: "mode_unavailable" }]);
  });

  it("a ligação de saída que cai não gera religação", async () => {
    const s = await dropped("cb outbound drop", {}, { direction: "outbound" });
    expect(await review(s.org, s.callId)).toBe("no_case");
    expect(await callBacksOf(s.org)).toEqual([]);
    expect(await followUpsOf(s.org)).toEqual([]);
  });

  it("o no_answer de uma ligação de saída comum (sem call_back_of) não abre pendência nem religação", async () => {
    const base = await organization("cb plain no answer");
    const callId = await callIn(base, [["call_ended", { status: "failed", reason: "no_answer", cause: null }]], { direction: "outbound", endReason: "no_answer", status: "failed" });
    expect(await review(base.org, callId)).toBe("no_case");
    expect(await callBacksOf(base.org)).toEqual([]);
    expect(await followUpsOf(base.org)).toEqual([]);
    expect(await payloadsOf(callId, "drop_follow_up_result")).toEqual([]);
  });
});

describe("review_call de uma religação: só o resultado, nunca a seção 2", () => {
  /** A original que caiu, a tentativa 1 já `placed` e a chamada da religação, com `events`. */
  async function placed(label: string, events: Ev[], call: Parameters<typeof callIn>[2] = {}) {
    const s = await dropped(label);
    await review(s.org, s.callId);
    const result = await callIn(s, events, { direction: "outbound", callBackOf: s.callId, ...call });
    await withSystem(app, (q) => q.exec("update call_backs set status = 'placed', result_call_id = $2 where origin_call_id = $1", [s.callId, result]));
    return { ...s, result };
  }

  it("atendida que cai de novo: grava call_back_answered com o custo e não gera nova religação nem pendência", async () => {
    const s = await placed("cb answered drops", hangup("caller_waiting"), { costCents: 42 });
    expect(await review(s.org, s.result)).toBe("call_back_result");
    expect(await payloadsOf(s.callId, "drop_follow_up_result")).toEqual([{ action: "call_back_answered", attempt: 1, callId: s.result, costCents: 42 }]);
    expect(await callBacksOf(s.org)).toHaveLength(1);
    expect(await followUpsOf(s.org)).toEqual([]);
    expect(await payloadsOf(s.result, "drop_follow_up")).toEqual([]);
    // Repetir não grava de novo.
    expect(await review(s.org, s.result)).toBe("already_reviewed");
    expect(await payloadsOf(s.callId, "drop_follow_up_result")).toHaveLength(1);
  });

  it("religação atendida em que o motor caiu (o caso 1) também não abre nada: a seção 2 não vale para ela", async () => {
    const s = await placed("cb answered engine", [["call_answered", { engine: "simulated" }], ["engine_failed", { engine: "openai-realtime", error: "socket closed" }]], { endReason: "engine_failed", status: "failed", costCents: 7 });
    expect(await review(s.org, s.result)).toBe("call_back_result");
    expect(await followUpsOf(s.org)).toEqual([]);
    expect(await callBacksOf(s.org)).toHaveLength(1);
    expect(await payloadsOf(s.callId, "drop_follow_up_result")).toEqual([{ action: "call_back_answered", attempt: 1, callId: s.result, costCents: 7 }]);
  });

  it("não atendida na última tentativa (CALL_BACK_ATTEMPTS = 1): abre a pendência de reserva e não agenda a segunda", async () => {
    const s = await placed("cb not answered", [["call_ended", { status: "failed", reason: "no_answer", cause: null }]], { endReason: "no_answer", status: "failed" });
    expect(await review(s.org, s.result)).toBe("call_back_result");
    expect(await payloadsOf(s.callId, "drop_follow_up_result")).toEqual([{ action: "call_back_not_answered", attempt: 1, callId: s.result, costCents: 0 }]);
    expect(await callBacksOf(s.org)).toHaveLength(1);
    expect((await tasksOf(app, s.org)).filter((row) => row.kind === "call_back")).toHaveLength(1);
    expect(await followUpsOf(s.org)).toEqual([expect.objectContaining({ call_id: s.callId, title: callBackFailedTitle(CALLER, "not_answered"), source: "review_call", owner_user_id: s.person })]);
    expect(callBackFailedTitle(CALLER, "not_answered")).toBe(`Retornar para ${CALLER}: a religação não aconteceu: ninguém atendeu`);
  });

  it("a chamada com call_back_of que não é a tentativa (outra linha, ou já resolvida) não grava nada", async () => {
    const s = await placed("cb stray", [["call_ended", { status: "failed", reason: "no_answer", cause: null }]], { endReason: "no_answer", status: "failed" });
    const stray = await callIn(s, [["call_ended", { status: "failed", reason: "no_answer", cause: null }]], { direction: "outbound", callBackOf: s.callId, endReason: "no_answer", status: "failed" });
    expect(await review(s.org, stray)).toBe("skipped");
    expect(await payloadsOf(s.callId, "drop_follow_up_result")).toEqual([]);
    expect(await followUpsOf(s.org)).toEqual([]);
  });
});

describe("a rotina call_back: a hora marcada", () => {
  const runRoutine = (org: string, callBackId: string) => callBackRoutine.run(task(org, "call_back", { callBackId }), depsFor(app));

  it("passa a linha a due e avisa no canal call_backs; não disca e não muda nada ao repetir", async () => {
    const s = await dropped("cb routine");
    await review(s.org, s.callId);
    const [row] = await callBacksOf(s.org);
    const heard: string[] = [];
    const stop = await listen(app, CALL_BACKS_CHANNEL, (payload) => void heard.push(payload));
    try {
      await runRoutine(s.org, row?.id ?? "");
      await until(() => heard.length === 1, "the call_backs notification");
      expect(heard).toEqual([row?.id]);
      expect((await callBacksOf(s.org))[0]?.status).toBe("due");
      await runRoutine(s.org, row?.id ?? "");
      expect((await callBacksOf(s.org))[0]?.status).toBe("due");
      // Nenhuma chamada nova: quem disca é o processo de voz.
      expect(await withSystem(app, (q) => q.many("select 1 from calls where organization_id = $1 and direction = 'outbound'", [s.org]))).toEqual([]);
    } finally {
      await stop();
    }
    expect(heard).toHaveLength(1);
  });

  it("duas rotinas ao mesmo tempo: a linha avança uma vez só", async () => {
    const s = await dropped("cb routine race");
    await review(s.org, s.callId);
    const [row] = await callBacksOf(s.org);
    const heard: string[] = [];
    const stop = await listen(app, CALL_BACKS_CHANNEL, (payload) => void (payload === row?.id && heard.push(payload)));
    try {
      await Promise.all([runRoutine(s.org, row?.id ?? ""), runRoutine(s.org, row?.id ?? ""), runRoutine(s.org, row?.id ?? "")]);
      await until(() => heard.length >= 1, "the call_backs notification");
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      await stop();
    }
    expect(heard).toHaveLength(1);
    expect((await callBacksOf(s.org))[0]?.status).toBe("due");
  });

  it("a original apagada a pedido do titular: o apagamento anula o número e cancela; a rotina não avança", async () => {
    const s = await dropped("cb erased");
    await review(s.org, s.callId);
    const [row] = await callBacksOf(s.org);
    const dir = await mkdtemp(join(tmpdir(), "deskvoice-cb-"));
    await withOrg(app, s.org, (q) => eraseCaller(q, { dir, phoneE164: CALLER, now: t0 }));
    expect(await callBacksOf(s.org)).toEqual([expect.objectContaining({ to_e164: null, status: "cancelled" })]);
    await runRoutine(s.org, row?.id ?? "");
    expect((await callBacksOf(s.org))[0]?.status).toBe("cancelled");
  });
});
