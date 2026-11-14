import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ERASED_TEXT, ERASED_TRANSCRIPT, ERASE_RECORDINGS_TASK, closeFollowUp, recordingPath, removeErasedRecordings, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { POST as erase } from "./privacy/erasure/route";
import { POST as preview } from "./privacy/erasure/preview/route";
import { POST as exportRecord } from "./privacy/export/route";

const panel = startPanel();
afterAll(() => panel.close());

const PHONE = "+5541988887777";
const LINE = "+5541333344444";
const HUMAN = "+5541322221111";
const OTHER = "+5541977776666";

const read = <T>(org: string, sql: string, params: unknown[] = []) => withOrg(panel.app, org, (q) => q.many<T & Record<string, unknown>>(sql, params));
const one = async <T>(org: string, sql: string, params: unknown[] = []) => (await read<T>(org, sql, params))[0];

// Cada texto que a pessoa disse ou que foi escrito sobre ela, para conferir depois que nenhum sobrou.
const SPOKEN = [
  "Quero remarcar.",
  "Claro, Helena.",
  "Pediu retorno.",
  "Me liga amanhã.",
  "Retornar amanhã.",
  "Não quero ser gravada.",
  "Helena Prado",
  "Consulta de Helena às 15h.",
  "Remarcar a Helena?",
  "Ela prefere de manhã.",
  "Helena pediu retorno urgente.",
  "Quer falar com a gerente.",
  "Helena, remarcação, já ofereci terça.",
  "4321",
  "Retornar sobre a remarcação",
  "Prefere de manhã.",
  "Retornou e remarcou.",
  "Confirmar endereço",
  "Aviso: Helena pediu retorno.",
];

const ANALYSIS = {
  rubricVersion: 1,
  model: "gemini-test",
  criteria: ["opening", "discovery", "objections", "accuracy", "closing"].map((id) => ({ id, status: "met", evidence: "Me liga amanhã." })),
  temperature: { start: "warm", middle: "warm", end: "hot" },
  objections: [{ objection: "Horário", quote: "Me liga amanhã.", response: "Combinou o retorno.", handled: "addressed" }],
  strengths: [],
  weaknesses: [],
  nextStep: "Retornar amanhã.",
  droppedObjections: 0,
};

/** Uma chamada encerrada com tudo que um dia foi dito ou escrito sobre quem ligou, em cada lugar onde a main guarda. */
async function seed(org: string, phone = PHONE): Promise<{ callId: string; file: string }> {
  const callId = await createCall(panel.app, org, NOW);
  await withOrg(panel.app, org, async (q) => {
    await q.exec(
      `update calls set status = 'completed', from_e164 = $2, to_e164 = $3, summary = 'Pediu retorno.', outcome = 'callback_requested', outcome_confidence = 0.8,
         outcome_evidence = 'Me liga amanhã.', analysis = $4, analysis_score = 8, recording_paused_at = $5, recording_paused_by = 'agent',
         recording_pause_reason = 'Não quero ser gravada.', cost_cents = 42, ended_at = $6 where id = $1`,
      [callId, phone, LINE, JSON.stringify(ANALYSIS), NOW, new Date(NOW.getTime() + 60_000)],
    );
    const events: Array<[string, object]> = [
      ["call_started", { direction: "inbound", from: phone, to: LINE }],
      ["recording_notice", { text: "Esta ligação é gravada." }],
      ["transcript_user", { text: "Quero remarcar." }],
      ["transcript_agent", { text: "Claro, Helena." }],
      ["tool_called", { name: "book", args: { name: "Helena Prado" } }],
      ["tool_result", { name: "book", ok: false, message: "Consulta de Helena às 15h.", error: "Helena Prado já tem horário" }],
      ["approval_requested", { approvalId: "a", question: "Remarcar a Helena?", context: "Ela prefere de manhã.", defaultOnTimeout: "denied" }],
      ["human_notified", { message: "Helena pediu retorno urgente.", urgency: "high", channels: ["panel"] }],
      ["transfer_started", { to: HUMAN, reason: "Quer falar com a gerente.", summary: "Helena, remarcação, já ofereci terça." }],
      ["transfer_started", { to: HUMAN, reason: "cost_ceiling" }],
      ["dtmf_sent", { digits: "4321" }],
      ["recording_paused", { by: "agent", reason: "Não quero ser gravada." }],
      ["call_ended", { status: "completed", reason: "hangup" }],
    ];
    for (const [kind, payload] of events) {
      await q.exec("insert into call_events (organization_id, call_id, at, kind, payload) values ($1, $2, $3, $4, $5)", [org, callId, NOW, kind, JSON.stringify(payload)]);
    }
    await q.exec("insert into approvals (organization_id, call_id, question, context, default_on_timeout, expires_at) values ($1, $2, 'Remarcar a Helena?', $3, 'denied', $4)", [
      org,
      callId,
      JSON.stringify({ text: "Ela prefere de manhã." }),
      NOW,
    ]);
    // Pela chamada e pelo telefone; pela chamada sem o telefone (fechada, com nota); pelo telefone sem a chamada.
    const byPhone = await q.one<{ id: string }>(
      "insert into follow_ups (organization_id, call_id, caller_e164, title, details, due_at, created_at) values ($1, $2, $3, 'Retornar sobre a remarcação', 'Prefere de manhã.', $4, $4) returning id",
      [org, callId, phone, NOW],
    );
    await q.exec(
      "insert into follow_ups (organization_id, call_id, title, details, due_at, created_at, status, closed_at, closing_note) values ($1, $2, 'Confirmar endereço', 'Prefere de manhã.', $3, $3, 'done', $3, 'Retornou e remarcou.')",
      [org, callId, NOW],
    );
    await q.exec("insert into follow_ups (organization_id, caller_e164, title, due_at, created_at) values ($1, $2, 'Confirmar endereço', $3, $3)", [org, phone, NOW]);
    await q.exec("insert into notifications (organization_id, call_id, channel, target, body, created_at) values ($1, $2, 'whatsapp', $3, 'Aviso: Helena pediu retorno.', $4)", [
      org,
      callId,
      HUMAN,
      NOW,
    ]);
    await q.exec("insert into notifications (organization_id, follow_up_id, channel, body, status, created_at) values ($1, $2, 'panel', 'Aviso: Helena pediu retorno.', 'sent', $3)", [
      org,
      byPhone?.id,
      NOW,
    ]);
    await q.exec("insert into do_not_call (organization_id, e164, reason) values ($1, $2, 'pediu') on conflict do nothing", [org, phone]);
  });
  const file = recordingPath(panel.deps.recordingsDir, org, callId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "RIFF....WAVE");
  return { callId, file };
}

const EXPECTED = { calls: 1, events: 10, followUps: 3, notifications: 2, approvals: 1, recordings: 1 };

describe("apagar a conversa a pedido do titular", () => {
  it("a prévia conta o que sairia e não apaga nada", async () => {
    const org = await createOrganization(panel.app, "erasure preview");
    const owner = await createUser(panel.app, org, "owner");
    const { callId, file } = await seed(org);

    const result = await call(preview, { method: "POST", cookie: owner.cookie, body: { phone: "(41) 98888-7777" } });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ phone: PHONE, ...EXPECTED, live: false });
    const row = await one<{ summary: string; erased_at: Date | null }>(org, "select summary, erased_at from calls where id = $1", [callId]);
    expect(row).toMatchObject({ summary: "Pediu retorno.", erased_at: null });
    await expect(access(file)).resolves.toBeUndefined();
  });

  it("o operador não vê a prévia nem apaga", async () => {
    const org = await createOrganization(panel.app, "erasure operator");
    const operator = await createUser(panel.app, org, "operator");
    await seed(org);

    for (const handler of [preview, erase]) {
      const result = await call(handler, { method: "POST", cookie: operator.cookie, body: { phone: PHONE } });
      expect([result.status, result.code]).toEqual([403, "forbidden"]);
    }
  });

  it("apaga a fala e o texto em todo lugar da chamada, anonimiza o titular e mantém o registro do serviço", async () => {
    const org = await createOrganization(panel.app, "erasure executed");
    const owner = await createUser(panel.app, org, "owner");
    const { callId } = await seed(org);
    // Outra pessoa na mesma organização e o mesmo telefone em outra organização: nada deles muda.
    const { callId: otherCall } = await seed(org, OTHER);
    const foreign = await createOrganization(panel.app, "erasure foreign");
    const { callId: foreignCall } = await seed(foreign);

    const result = await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect(result.status).toBe(200);
    expect(result.data).toEqual(EXPECTED);

    const row = await one<Record<string, unknown>>(
      org,
      "select summary, outcome, outcome_evidence, analysis, analysis_score, recording_paused_at, recording_paused_by, recording_pause_reason, from_e164, to_e164, cost_cents, ended_at, erased_at from calls where id = $1",
      [callId],
    );
    expect(row).toMatchObject({ summary: ERASED_TEXT, outcome_evidence: null, recording_pause_reason: null, from_e164: null, analysis_score: 8, outcome: "callback_requested" });
    // O outro lado é a linha da empresa, não a pessoa; quem parou a gravação e quando são fato, não fala.
    expect(row).toMatchObject({ to_e164: LINE, cost_cents: 42, recording_paused_by: "agent" });
    expect(row?.recording_paused_at).not.toBeNull();
    expect(row?.ended_at).not.toBeNull();
    expect(row?.erased_at).not.toBeNull();
    expect(row?.analysis).toEqual({
      rubricVersion: 1,
      model: "gemini-test",
      criteria: ANALYSIS.criteria.map(({ id, status }) => ({ id, status })),
      temperature: ANALYSIS.temperature,
      objectionCount: 1,
      purged: true,
    });

    const events = await read<{ kind: string; payload: Record<string, unknown> }>(org, "select kind, payload from call_events where call_id = $1 order by id", [callId]);
    const byKind = (kind: string) => events.filter((event) => event.kind === kind).map((event) => event.payload);
    expect(byKind("call_started")).toEqual([{ direction: "inbound", from: null, to: LINE, erased: true }]);
    expect(byKind("recording_notice")).toEqual([{ text: "Esta ligação é gravada." }]);
    expect(byKind("transcript_user")).toEqual([ERASED_TRANSCRIPT]);
    expect(byKind("transcript_agent")).toEqual([ERASED_TRANSCRIPT]);
    expect(byKind("tool_called")).toEqual([{ name: "book", erased: true }]);
    expect(byKind("tool_result")).toEqual([{ name: "book", ok: false, erased: true }]);
    expect(byKind("approval_requested")).toEqual([{ approvalId: "a", defaultOnTimeout: "denied", erased: true }]);
    expect(byKind("human_notified")).toEqual([{ urgency: "high", channels: ["panel"], erased: true }]);
    expect(byKind("transfer_started")).toEqual([{ to: HUMAN, erased: true }, { to: HUMAN, reason: "cost_ceiling" }]);
    expect(byKind("dtmf_sent")).toEqual([{ erased: true }]);
    expect(byKind("recording_paused")).toEqual([{ by: "agent", reasonPurged: true, erased: true }]);
    expect(byKind("call_ended")).toEqual([{ status: "completed", reason: "hangup" }]);

    const followUps = await read<{ caller_e164: string | null; title: string; details: string; closing_note: string | null; status: string }>(
      org,
      "select caller_e164, title, details, closing_note, status from follow_ups where call_id = $1 or (call_id is null and caller_e164 is null)",
      [callId],
    );
    expect(followUps).toHaveLength(3);
    for (const followUp of followUps) expect(followUp).toMatchObject({ caller_e164: null, title: ERASED_TEXT, details: "", closing_note: null });
    // A pendência fechada continua fechada: o apagamento troca o texto, não o estado.
    expect(followUps.map((followUp) => followUp.status).sort()).toEqual(["done", "open", "open"]);

    const notifications = await read<{ body: string; target: string | null }>(org, "select n.body, n.target from notifications n left join follow_ups f on f.id = n.follow_up_id where coalesce(n.call_id, f.call_id) = $1", [callId]);
    expect(notifications.map((notification) => notification.body)).toEqual([ERASED_TEXT, ERASED_TEXT]);

    const approval = await one<{ question: string; context: unknown }>(org, "select question, context from approvals where call_id = $1", [callId]);
    expect(approval).toEqual({ question: ERASED_TEXT, context: { erased: true } });

    // A lista de não ligar fica: é ela que impede ligar de novo para quem pediu.
    expect(await read(org, "select 1 from do_not_call where e164 = $1", [PHONE])).toHaveLength(1);

    // Nenhum texto sobre a pessoa sobrou nas linhas dela.
    const leftovers = JSON.stringify([row, events, followUps, notifications, approval]);
    for (const spoken of SPOKEN) expect(leftovers).not.toContain(spoken);
    expect(leftovers).not.toContain(PHONE);

    // A outra pessoa e a outra organização continuam inteiras.
    for (const [orgId, id] of [[org, otherCall], [foreign, foreignCall]] as const) {
      const untouched = await one<{ summary: string; erased_at: Date | null }>(orgId, "select summary, erased_at from calls where id = $1", [id]);
      expect(untouched).toEqual({ summary: "Pediu retorno.", erased_at: null });
      expect(await read(orgId, "select 1 from call_events where call_id = $1 and payload ? 'text' and kind = 'transcript_user'", [id])).toHaveLength(1);
    }
    expect(await read(foreign, "select 1 from follow_ups where caller_e164 = $1", [PHONE])).toHaveLength(2);
    expect(await read(org, "select 1 from follow_ups where caller_e164 = $1 and title <> $2", [OTHER, ERASED_TEXT])).toHaveLength(2);
  });

  it("depois de apagar, a exportação do mesmo telefone não devolve fala, resumo, análise, motivo, pendência nem aviso", async () => {
    const org = await createOrganization(panel.app, "erasure export");
    const owner = await createUser(panel.app, org, "owner");
    await seed(org);

    await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    const exported = await call(exportRecord, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });

    expect(exported.status).toBe(200);
    const { content, counts } = exported.data as { content: string; counts: Record<string, unknown> };
    for (const spoken of SPOKEN) expect(content).not.toContain(spoken);
    // Só a lista de não ligar continua ligada ao número.
    expect(counts).toEqual({ calls: 0, events: 0, doNotCall: true, followUps: 0 });
  });

  it("recusa enquanto houver chamada viva desse telefone, e a prévia avisa", async () => {
    const org = await createOrganization(panel.app, "erasure live");
    const owner = await createUser(panel.app, org, "owner");
    const { callId } = await seed(org);
    const live = await createCall(panel.app, org, NOW);
    await withOrg(panel.app, org, (q) => q.exec("update calls set from_e164 = $2, status = 'in_progress' where id = $1", [live, PHONE]));

    const seen = await call(preview, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect(seen.data).toMatchObject({ live: true });

    const refused = await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect([refused.status, refused.code]).toEqual([409, "caller_call_live"]);
    expect(await one(org, "select summary, erased_at from calls where id = $1", [callId])).toEqual({ summary: "Pediu retorno.", erased_at: null });
    expect(await read(org, "select 1 from organization_events where kind = 'caller_data_erased'")).toHaveLength(0);
    expect(await read(org, "select 1 from tasks where kind = $1", [ERASE_RECORDINGS_TASK])).toHaveLength(0);
  });

  it("o banco confirma antes; o arquivo sai depois, pela tarefa, e o que não sai fica contado e é alcançado de novo", async () => {
    const org = await createOrganization(panel.app, "erasure order");
    const owner = await createUser(panel.app, org, "owner");
    const { callId, file } = await seed(org);
    const tasks = () => read<{ id: string; status: string }>(org, "select id, status from tasks where kind = $1 order by created_at", [ERASE_RECORDINGS_TASK]);
    const recordingEvents = () => read<{ payload: unknown }>(org, "select payload from organization_events where kind = 'caller_recordings_erased' order by id");

    await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    // O painel não toca no arquivo: só a tarefa, que existe porque o banco confirmou.
    await expect(access(file)).resolves.toBeUndefined();
    expect((await tasks()).map((task) => task.status)).toEqual(["queued"]);

    // A remoção falha (no lugar do arquivo há uma pasta): não é silenciosa.
    await rm(file);
    await mkdir(path.join(file, "dentro"), { recursive: true });
    const failed = await removeErasedRecordings(panel.app, { dir: panel.deps.recordingsDir, organizationId: org, now: NOW });
    expect([failed.removed, failed.left]).toEqual([0, 1]);
    expect(await recordingEvents()).toEqual([{ payload: { removed: 0, left: 1 } }]);
    expect(await one(org, "select erased_at is not null as erased from calls where id = $1", [callId])).toEqual({ erased: true });

    // Um novo pedido não reconta o banco, mas põe outra passagem na fila, e ela alcança o arquivo que ficou.
    await rm(file, { recursive: true });
    await writeFile(file, "RIFF....WAVE");
    await withOrg(panel.app, org, (q) => q.exec("update tasks set status = 'done' where kind = $1", [ERASE_RECORDINGS_TASK]));
    const again = await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect(again.data).toEqual({ calls: 0, events: 0, followUps: 0, notifications: 0, approvals: 0, recordings: 0 });
    expect((await tasks()).map((task) => task.status)).toEqual(["done", "queued"]);
    const done = await removeErasedRecordings(panel.app, { dir: panel.deps.recordingsDir, organizationId: org, now: NOW });
    expect([done.removed, done.left]).toEqual([1, 0]);
    await expect(access(file)).rejects.toThrow();
    expect((await recordingEvents()).at(-1)).toEqual({ payload: { removed: 1, left: 0 } });
  });

  it("a gravação que ainda é .part quando a chamada já tem ended_at sai na mesma passagem, e o .wav nunca aparece", async () => {
    const org = await createOrganization(panel.app, "erasure part");
    const owner = await createUser(panel.app, org, "owner");
    const { file } = await seed(org);
    // O processo de voz grava `ended_at` antes de trocar o `.part` pelo `.wav`.
    await rename(file, `${file}.part`);

    const seen = await call(preview, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect(seen.data).toMatchObject({ recordings: 1 });
    await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    const swept = await removeErasedRecordings(panel.app, { dir: panel.deps.recordingsDir, organizationId: org, now: NOW });
    expect([swept.removed, swept.left]).toEqual([1, 0]);

    // A troca que o processo de voz faria depois falha, e não há arquivo nenhum.
    await expect(rename(`${file}.part`, file)).rejects.toThrow();
    await expect(access(file)).rejects.toThrow();
  });

  it("a pendência apagada fecha sem nota: texto escrito depois não ficaria ao alcance de um novo pedido", async () => {
    const org = await createOrganization(panel.app, "erasure close");
    const owner = await createUser(panel.app, org, "owner");
    await seed(org);
    await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });

    const open = await one<{ id: string }>(org, "select id from follow_ups where status = 'open' and title = $1 limit 1", [ERASED_TEXT]);
    const closed = await withOrg(panel.app, org, (q) => closeFollowUp(q, String(open?.id), { status: "done", note: "Helena ligou de novo.", closedBy: owner.id }, NOW));
    expect(closed).toBe("closed");
    expect(await one(org, "select status, closing_note from follow_ups where id = $1", [open?.id])).toEqual({ status: "done", closing_note: null });
  });

  it("exportar a própria linha da empresa não devolve as chamadas de quem ligou para ela", async () => {
    const org = await createOrganization(panel.app, "export own line");
    const owner = await createUser(panel.app, org, "owner");
    // Uma linha da empresa que passa na validação de telefone.
    const OWN = "+554133334444";
    const { callId } = await seed(org);
    await withOrg(panel.app, org, (q) => q.exec("update calls set to_e164 = $2 where id = $1", [callId, OWN]));

    const exported = await call(exportRecord, { method: "POST", cookie: owner.cookie, body: { phone: OWN } });

    expect(exported.status).toBe(200);
    const { content, counts } = exported.data as { content: string; counts: Record<string, unknown> };
    expect(counts).toMatchObject({ calls: 0, events: 0 });
    for (const spoken of SPOKEN) expect(content).not.toContain(spoken);
    // A pessoa, pelo telefone dela, continua achando a própria chamada.
    const subject = await call(exportRecord, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect((subject.data as { counts: Record<string, unknown> }).counts).toMatchObject({ calls: 1 });
  });

  it("repetir o pedido não reconta nem reescreve", async () => {
    const org = await createOrganization(panel.app, "erasure twice");
    const owner = await createUser(panel.app, org, "owner");
    await seed(org);

    await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    const second = await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect(second.data).toEqual({ calls: 0, events: 0, followUps: 0, notifications: 0, approvals: 0, recordings: 0 });
  });

  it("o titular é sempre o outro lado: a própria linha não alcança nada, e a ligação feita para a pessoa entra", async () => {
    const org = await createOrganization(panel.app, "erasure subject");
    const owner = await createUser(panel.app, org, "owner");
    // Uma linha da empresa que passa na validação de telefone, para o pedido chegar ao apagamento.
    const OWN = "+554133334444";
    const { callId: inbound } = await seed(org);
    const outbound = await createCall(panel.app, org, NOW);
    await withOrg(panel.app, org, async (q) => {
      await q.exec("update calls set to_e164 = $2 where id = $1", [inbound, OWN]);
      await q.exec("update calls set direction = 'outbound', status = 'completed', from_e164 = $2, to_e164 = $3, summary = 'Confirmou.', ended_at = $4 where id = $1", [
        outbound,
        OWN,
        PHONE,
        new Date(NOW.getTime() + 60_000),
      ]);
    });

    const ownLine = await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: OWN } });
    expect([ownLine.status, ownLine.code]).toEqual([200, undefined]);
    expect(ownLine.data).toMatchObject({ calls: 0 });
    const untouched = await one<{ summary: string; erased_at: Date | null }>(org, "select summary, erased_at from calls where id = $1", [inbound]);
    expect(untouched).toMatchObject({ summary: "Pediu retorno.", erased_at: null });

    const subject = await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect(subject.data).toMatchObject({ calls: 2 });
    const placed = await one<{ to_e164: string | null; from_e164: string | null }>(org, "select to_e164, from_e164 from calls where id = $1", [outbound]);
    expect(placed).toEqual({ to_e164: null, from_e164: OWN });
  });

  it("o recibo guarda quem pediu e as contagens, sem fala, sem motivo livre e sem o telefone em claro", async () => {
    const org = await createOrganization(panel.app, "erasure receipt");
    const owner = await createUser(panel.app, org, "owner");
    await seed(org);

    const withReason = await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE, reason: "Helena pediu" } });
    expect([withReason.status, withReason.code]).toEqual([400, "validation_error"]);

    await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    const [event, ...rest] = await read<{ actor_user_id: string | null; payload: Record<string, unknown> }>(
      org,
      "select actor_user_id, payload from organization_events where kind = 'caller_data_erased'",
    );
    expect(rest).toHaveLength(0);
    expect(event?.actor_user_id).toBe(owner.id);
    expect(event?.payload).toEqual({ ...EXPECTED, phoneSuffix: "7777" });
    const receipt = JSON.stringify(event?.payload);
    expect(receipt).not.toContain(PHONE);
    for (const spoken of SPOKEN) expect(receipt).not.toContain(spoken);
  });
});
