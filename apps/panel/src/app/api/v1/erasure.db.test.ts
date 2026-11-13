import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ERASED_TEXT, PURGED_TRANSCRIPT, recordingPath, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { POST as erase } from "./privacy/erasure/route";
import { POST as preview } from "./privacy/erasure/preview/route";

const panel = startPanel();
afterAll(() => panel.close());

const PHONE = "+5541988887777";
const LINE = "+5541333344444";

const read = <T>(org: string, sql: string, params: unknown[] = []) =>
  withOrg(panel.app, org, (q) => q.many<T & Record<string, unknown>>(sql, params));

interface Row {
  summary: string | null;
  outcome_evidence: string | null;
  from_e164: string | null;
  to_e164: string | null;
  cost_cents: number;
  ended_at: Date | null;
  erased_at: Date | null;
}

/** Uma chamada com tudo que um dia foi dito: resumo, citação, duas falas, pendência e gravação. */
async function seed(org: string): Promise<{ callId: string; file: string }> {
  const callId = await createCall(panel.app, org, NOW);
  await withOrg(panel.app, org, async (q) => {
    await q.exec(
      "update calls set from_e164 = $2, to_e164 = $3, summary = 'Pediu retorno.', outcome = 'callback_requested', outcome_confidence = 0.8, outcome_evidence = 'Me liga amanhã.', cost_cents = 42, ended_at = $4 where id = $1",
      [callId, PHONE, LINE, new Date(NOW.getTime() + 60_000)],
    );
    await q.exec(
      "insert into call_events (organization_id, call_id, at, kind, payload) values ($1,$2,$3,'transcript_user',$4), ($1,$2,$3,'transcript_agent',$5)",
      [org, callId, NOW, JSON.stringify({ text: "Quero remarcar." }), JSON.stringify({ text: "Claro, Helena." })],
    );
    await q.exec(
      "insert into follow_ups (organization_id, call_id, caller_e164, title, details, due_at, created_at) values ($1,$2,$3,'Retornar sobre a remarcação','Prefere de manhã.',$4,$4)",
      [org, callId, PHONE, NOW],
    );
  });
  const file = recordingPath(panel.deps.recordingsDir, org, callId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "RIFF....WAVE");
  return { callId, file };
}

describe("apagar a conversa a pedido do titular", () => {
  it("a prévia conta o que sairia e não apaga nada", async () => {
    const org = await createOrganization(panel.app, "erasure preview");
    const owner = await createUser(panel.app, org, "owner");
    const { callId, file } = await seed(org);

    const result = await call(preview, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ phone: PHONE, calls: 1, events: 2, recordings: 1, followUps: 1 });
    const [row] = await read<Row>(org, "select summary, erased_at from calls where id = $1", [callId]);
    expect(row?.summary).toBe("Pediu retorno.");
    expect(row?.erased_at).toBeNull();
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

  it("apaga o conteúdo, anonimiza o titular e mantém o registro do serviço", async () => {
    const org = await createOrganization(panel.app, "erasure executed");
    const owner = await createUser(panel.app, org, "owner");
    const { callId, file } = await seed(org);

    const result = await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE, reason: "pedido do titular" } });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ calls: 1, events: 2, recordings: 1, followUps: 1 });

    const [row] = await read<Row>(
      org,
      "select summary, outcome_evidence, from_e164, to_e164, cost_cents, ended_at, erased_at from calls where id = $1",
      [callId],
    );
    expect(row?.summary).toBe(ERASED_TEXT);
    expect(row?.outcome_evidence).toBeNull();
    expect(row?.from_e164).toBeNull();
    // O outro lado é a linha da empresa, não a pessoa: fica.
    expect(row?.to_e164).toBe(LINE);
    expect(row?.cost_cents).toBe(42);
    expect(row?.ended_at).not.toBeNull();
    expect(row?.erased_at).not.toBeNull();

    const events = await read<{ payload: unknown }>(org, "select payload from call_events where call_id = $1 order by id", [callId]);
    expect(events).toHaveLength(2);
    for (const event of events) expect(event.payload).toEqual(PURGED_TRANSCRIPT);

    const [followUp] = await read<{ title: string; details: string }>(org, "select title, details from follow_ups");
    expect(followUp?.title).toBe(ERASED_TEXT);
    expect(followUp?.details).toBe("");

    await expect(access(file)).rejects.toThrow();
  });

  it("repetir o pedido não reconta nem reescreve", async () => {
    const org = await createOrganization(panel.app, "erasure twice");
    const owner = await createUser(panel.app, org, "owner");
    await seed(org);

    await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    const second = await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect(second.data).toEqual({ calls: 0, events: 0, recordings: 0, followUps: 0 });
  });

  it("o recibo fica nos eventos da organização, com quem pediu", async () => {
    const org = await createOrganization(panel.app, "erasure receipt");
    const owner = await createUser(panel.app, org, "owner");
    await seed(org);

    await call(erase, { method: "POST", cookie: owner.cookie, body: { phone: PHONE, reason: "pedido do titular" } });
    const [event] = await read<{ kind: string; actor_user_id: string | null; payload: Record<string, unknown> }>(
      org,
      "select kind, actor_user_id, payload from organization_events where kind = 'caller_data_erased'",
    );
    expect(event?.actor_user_id).toBe(owner.id);
    expect(event?.payload).toMatchObject({ calls: 1, events: 2, recordings: 1, followUps: 1, reason: "pedido do titular" });
  });
});
