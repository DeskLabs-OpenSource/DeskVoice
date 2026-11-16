// O motivo e o resumo de `agent_handoff` (a passagem entre agentes, fatia 4a) são fala resumida de quem
// ligou: saem pelo apagamento a pedido do titular e pelo prazo de guarda da transcrição (registro 0020).
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { eraseCaller } from "./erasures";
import { PURGED_TRANSCRIPT, purgeTranscripts, recordEvent } from "./events";
import { withOrg, withSystem } from "./with-org";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const PHONE = "+5531977776666";
const t = (minutes: number): Date => new Date(Date.UTC(2026, 2, 1, 15, minutes));
const FROM = { id: randomUUID(), name: "Recepção" };
const TO = { id: randomUUID(), name: "Agendamento" };
const HANDOFF = { from: FROM, to: TO, reason: "quer remarcar o exame", summary: "Cliente: meu exame deu alterado, quer remarcar." };

async function endedCall(org: string, at: Date): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into calls (id, organization_id, direction, channel, status, from_e164, to_e164, started_at, ended_at) values ($1, $2, 'inbound', 'phone', 'completed', $3, '+553133334444', $4, $4)", [
      id,
      org,
      PHONE,
      at,
    ]),
  );
  await withOrg(app, org, (q) => recordEvent(q, id, "agent_handoff", HANDOFF, at));
  return id;
}

const handoffsOf = async (callId: string): Promise<Array<Record<string, unknown>>> =>
  (await owner.pool.query<{ payload: Record<string, unknown> }>("select payload from call_events where call_id = $1 and kind = 'agent_handoff' order by id", [callId])).rows.map((row) => row.payload);

describe("agent_handoff e o texto sobre quem ligou", () => {
  it("o apagamento a pedido do titular tira o motivo e o resumo, e deixa os agentes", async () => {
    const org = await createOrganization(app, "passagem apagamento");
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-passagem-"));
    try {
      const callId = await endedCall(org, t(0));
      const erased = await withOrg(app, org, (q) => eraseCaller(q, { dir, phoneE164: PHONE, now: t(10) }));
      expect(erased).toMatchObject({ calls: 1 });
      const [payload] = await handoffsOf(callId);
      expect(payload).toEqual({ from: FROM, to: TO, erased: true });
      expect(JSON.stringify(payload)).not.toMatch(/exame|remarcar/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("o prazo de guarda da transcrição tira o motivo e o resumo, conta a troca uma vez e não toca o que é mais novo", async () => {
    const org = await createOrganization(app, "passagem prazo");
    const old = await endedCall(org, t(0));
    const recent = await endedCall(org, t(30));

    expect(await withOrg(app, org, (q) => purgeTranscripts(q, t(10)))).toBe(1);
    expect(await handoffsOf(old)).toEqual([{ from: FROM, to: TO, ...PURGED_TRANSCRIPT }]);
    expect(await handoffsOf(recent)).toEqual([HANDOFF]);
    // A segunda passagem não reconta o que já saiu.
    expect(await withOrg(app, org, (q) => purgeTranscripts(q, t(10)))).toBe(0);
  });

  it("o prazo de uma organização não alcança a passagem de outra", async () => {
    const org = await createOrganization(app, "passagem prazo a");
    const other = await createOrganization(app, "passagem prazo b");
    const theirs = await endedCall(other, t(0));
    await withOrg(app, org, (q) => purgeTranscripts(q, t(10)));
    expect(await handoffsOf(theirs)).toEqual([HANDOFF]);
  });
});
