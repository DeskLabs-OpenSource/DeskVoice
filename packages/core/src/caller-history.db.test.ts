import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { callerHistory } from "./caller-history";
import { ERASED_TEXT, eraseCaller } from "./erasures";
import { PURGED_SUMMARY_TEXT } from "./events";
import { withOrg, withSystem } from "./with-org";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const PHONE = "+5531988880001";
const t = (minutes: number): Date => new Date(Date.UTC(2026, 2, 1, 12, minutes));

interface CallInput {
  at: Date;
  from?: string | null;
  to?: string | null;
  direction?: "inbound" | "outbound";
  summary?: string | null;
  ended?: boolean;
  agentId?: string | null;
  channel?: "phone" | "simulated";
}

async function agentOf(organizationId: string, name: string): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) => q.exec("insert into agents (id, organization_id, name, engine) values ($1, $2, $3, 'simulated')", [id, organizationId, name]));
  return id;
}

async function callOf(organizationId: string, input: CallInput): Promise<string> {
  const id = randomUUID();
  const ended = input.ended ?? true;
  await withSystem(app, (q) =>
    q.exec(
      `insert into calls (id, organization_id, agent_id, direction, channel, status, from_e164, to_e164, summary, started_at, ended_at)
       values ($1, $2, $3, $4, $11, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        organizationId,
        input.agentId ?? null,
        input.direction ?? "inbound",
        ended ? "completed" : "in_progress",
        input.from ?? null,
        input.to ?? null,
        input.summary ?? null,
        input.at,
        ended ? new Date(input.at.getTime() + 60_000) : null,
        input.channel ?? "phone",
      ],
    ),
  );
  return id;
}

async function followUpOf(organizationId: string, callId: string, title: string, options: { caller?: string | null; status?: "open" | "done" } = {}): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec(
      `insert into follow_ups (id, organization_id, call_id, caller_e164, title, status, due_at, created_at, closed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
      [id, organizationId, callId, options.caller === undefined ? PHONE : options.caller, title, options.status ?? "open", t(30), options.status === "done" ? t(31) : null],
    ),
  );
  return id;
}

const historyOf = (organizationId: string, callId: string) => withOrg(app, organizationId, (q) => callerHistory(q, callId));

describe("callerHistory: a memória do número para a equipe", () => {
  it("o mesmo número em duas organizações nunca mostra a ligação nem a pendência da outra", async () => {
    const orgA = await createOrganization(app, "memoria A");
    const orgB = await createOrganization(app, "memoria B");
    const agentA = await agentOf(orgA, "Recepção A");
    const firstA = await callOf(orgA, { at: t(0), from: PHONE, summary: "Desfecho: concluída.", agentId: agentA });
    await followUpOf(orgA, firstA, "Retornar sobre o orçamento");
    const firstB = await callOf(orgB, { at: t(1), from: PHONE, summary: "Texto da organização B." });
    const followUpB = await followUpOf(orgB, firstB, "Pendência só da B");
    const secondA = await callOf(orgA, { at: t(5), from: PHONE, ended: false });
    const secondB = await callOf(orgB, { at: t(6), from: PHONE, ended: false });

    const a = await historyOf(orgA, secondA);
    expect(a).toMatchObject({ phone: PHONE, callCount: 1, openFollowUpCount: 1 });
    expect(a?.calls).toEqual([expect.objectContaining({ id: firstA, agentName: "Recepção A", summary: "Desfecho: concluída.", erased: false, summaryPurged: false })]);
    expect(a?.openFollowUps).toEqual([expect.objectContaining({ callId: firstA, title: "Retornar sobre o orçamento" })]);
    const textA = JSON.stringify(a);
    for (const theirs of [firstB, followUpB, "Texto da organização B.", "Pendência só da B"]) expect(textA).not.toContain(theirs);

    const b = await historyOf(orgB, secondB);
    expect(b).toMatchObject({ callCount: 1, openFollowUpCount: 1, calls: [{ id: firstB }], openFollowUps: [{ id: followUpB }] });

    // A chamada de B pedida dentro da organização A não existe ali.
    expect(await historyOf(orgA, secondB)).toBeNull();
  });

  it("nunca roda em transação de sistema, onde a RLS não separa as organizações", async () => {
    const orgA = await createOrganization(app, "memoria sistema");
    const callId = await callOf(orgA, { at: t(0), from: PHONE });
    await expect(withSystem(app, (q) => callerHistory(q, callId))).rejects.toThrow(/withOrg/);
  });

  it("ligação sem número não lembra nem é lembrada", async () => {
    const org = await createOrganization(app, "memoria sem numero");
    const anonymous = await callOf(org, { at: t(0) });
    await callOf(org, { at: t(1) });
    expect(await historyOf(org, anonymous)).toBeNull();
    const later = await callOf(org, { at: t(2), from: PHONE });
    expect(await historyOf(org, later)).toEqual({ phone: PHONE, callCount: 0, simulatedCallCount: 0, calls: [], openFollowUpCount: 0, simulatedOpenFollowUpCount: 0, openFollowUps: [], noteCount: 0, simulatedNoteCount: 0, notes: [] });
  });

  it("usa o telefone do outro lado: o to_e164 na feita, e nunca a linha da empresa", async () => {
    const org = await createOrganization(app, "memoria lado");
    const line = "+5531300000000";
    const outbound = await callOf(org, { at: t(0), direction: "outbound", from: line, to: PHONE });
    // A recebida de outra pessoa na mesma linha da empresa não é deste número.
    await callOf(org, { at: t(1), from: "+5531977770000", to: line });
    const current = await callOf(org, { at: t(2), from: PHONE, to: line, ended: false });
    expect(await historyOf(org, current)).toMatchObject({ callCount: 1, calls: [{ id: outbound, direction: "outbound" }] });

    // E a linha da empresa como "número" não junta as ligações de todo mundo: quem liga da própria
    // linha não vê as recebidas nela nem as feitas por ela.
    const fromLine = await callOf(org, { at: t(3), from: line, to: "+5531966660000", ended: false });
    expect(await historyOf(org, fromLine)).toMatchObject({ phone: line, callCount: 0, calls: [] });
  });

  it("só as ligações anteriores, as mais novas primeiro; só as pendências abertas", async () => {
    const org = await createOrganization(app, "memoria ordem");
    const first = await callOf(org, { at: t(0), from: PHONE });
    const second = await callOf(org, { at: t(1), from: PHONE });
    const current = await callOf(org, { at: t(2), from: PHONE, ended: false });
    await callOf(org, { at: t(3), from: PHONE });
    await followUpOf(org, first, "Já resolvida", { status: "done" });
    await followUpOf(org, second, "Ainda aberta");

    const history = await historyOf(org, current);
    expect(history?.calls.map((call) => call.id)).toEqual([second, first]);
    expect(history?.callCount).toBe(2);
    expect(history?.openFollowUps.map((followUp) => followUp.title)).toEqual(["Ainda aberta"]);
    expect(history?.openFollowUpCount).toBe(1);
  });

  it("acima de 10: a tela lista as 10 mais novas, e as contagens são as inteiras", async () => {
    const org = await createOrganization(app, "memoria acima de 10");
    const ids: string[] = [];
    for (let minute = 0; minute < 12; minute += 1) ids.push(await callOf(org, { at: t(minute), from: PHONE }));
    for (let index = 0; index < 12; index += 1) await followUpOf(org, ids[index] ?? "", `Pendência ${index}`);
    const current = await callOf(org, { at: t(20), from: PHONE, ended: false });

    const history = await historyOf(org, current);
    expect(history).toMatchObject({ callCount: 12, openFollowUpCount: 12 });
    expect(history?.calls.map((call) => call.id)).toEqual(ids.slice(2).reverse());
    expect(history?.openFollowUps).toHaveLength(10);
  });

  it("a simulada com o número de um cliente aparece marcada como simulada, e a contagem a separa", async () => {
    // A rota de simular não pede papel: qualquer pessoa da equipe simula com o número de um cliente.
    const org = await createOrganization(app, "memoria simulada");
    const real = await callOf(org, { at: t(0), from: PHONE });
    const simulated = await callOf(org, { at: t(1), from: PHONE, channel: "simulated" });
    const current = await callOf(org, { at: t(2), from: PHONE, ended: false });

    const history = await historyOf(org, current);
    expect(history).toMatchObject({ callCount: 2, simulatedCallCount: 1 });
    expect(history?.calls.map((call) => [call.id, call.simulated])).toEqual([
      [simulated, true],
      [real, false],
    ]);
  });

  it("o resumo trocado pelo prazo de guarda vem como marcado, sem o texto do marcador", async () => {
    const org = await createOrganization(app, "memoria prazo");
    await callOf(org, { at: t(0), from: PHONE, summary: PURGED_SUMMARY_TEXT });
    const current = await callOf(org, { at: t(1), from: PHONE, ended: false });
    expect((await historyOf(org, current))?.calls).toEqual([expect.objectContaining({ summary: null, summaryPurged: true, erased: false })]);
  });

  it("apagamento a pedido do titular: a ligação e a pendência apagadas não aparecem, e nada do texto delas volta", async () => {
    const org = await createOrganization(app, "memoria apagamento");
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-memoria-"));
    try {
      const first = await callOf(org, { at: t(0), from: PHONE, summary: "Cliente: meu exame deu alterado." });
      await followUpOf(org, first, "Ligar sobre o exame alterado");
      const erased = await withOrg(app, org, (q) => eraseCaller(q, { dir, phoneE164: PHONE, now: t(10) }));
      expect(erased).toMatchObject({ calls: 1, followUps: 1 });

      // Ela liga de novo: a ligação apagada perdeu o telefone, e a pendência apagada (caller_e164 nulo) não volta.
      const again = await callOf(org, { at: t(20), from: PHONE, ended: false });
      const history = await historyOf(org, again);
      expect(history).toEqual({ phone: PHONE, callCount: 0, simulatedCallCount: 0, calls: [], openFollowUpCount: 0, simulatedOpenFollowUpCount: 0, openFollowUps: [], noteCount: 0, simulatedNoteCount: 0, notes: [] });
      expect(JSON.stringify(history)).not.toMatch(/exame|apagado a pedido/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("chamada marcada como apagada que ainda tenha o telefone aparece sem conteúdo", async () => {
    // Defesa a mais: `eraseCaller` tira o telefone, mas se uma linha apagada o mantiver, nada do resumo sai.
    const org = await createOrganization(app, "memoria apagada com numero");
    const old = await callOf(org, { at: t(0), from: PHONE, summary: "Texto que não pode sair." });
    await withSystem(app, (q) => q.exec("update calls set erased_at = $2 where id = $1", [old, t(5)]));
    const stale = await callOf(org, { at: t(1), from: PHONE });
    await followUpOf(org, stale, ERASED_TEXT);
    const current = await callOf(org, { at: t(10), from: PHONE, ended: false });

    const history = await historyOf(org, current);
    expect(history?.calls.find((call) => call.id === old)).toMatchObject({ summary: null, erased: true });
    expect(JSON.stringify(history)).not.toContain("Texto que não pode sair.");
    expect(history).toMatchObject({ openFollowUpCount: 0, openFollowUps: [] });
  });
});
