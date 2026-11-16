import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import {
  CALLER_MEMORY_MAX_CHARS,
  CALLER_MEMORY_MAX_FOLLOW_UPS,
  CALLER_MEMORY_MAX_NOTES,
  CALLER_NOTES_RETENTION_SETTING,
  deleteCallerNote,
  fitCallerMemory,
  forgetCaller,
  loadCallerMemory,
} from "./caller-memory";
import { eraseCaller } from "./erasures";
import { rememberedBlock } from "./remembered-text";
import { TRANSCRIPT_RETENTION_SETTING } from "./retention";
import { withOrg, withSystem } from "./with-org";

/**
 * O que o agente recebe sobre o número (fatia 6 do desenho de 13/11, registro 0020, item 4): as notas
 * dentro do prazo e os títulos das pendências abertas, sem simulada, sem resumo nem fala, no teto de
 * 1 500 caracteres, e nunca de outra organização.
 */
const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const PHONE = "+5531922221111";
const LINE = "+553133331111";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(Date.UTC(2026, 5, 1, 12, 0));
const daysAgo = (days: number, minutes = 0): Date => new Date(NOW.getTime() - days * DAY_MS + minutes * 60_000);

async function callOf(
  organizationId: string,
  input: { at: Date; direction?: "inbound" | "outbound"; from?: string | null; to?: string | null; channel?: "phone" | "simulated"; summary?: string },
): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into calls (id, organization_id, direction, channel, status, from_e164, to_e164, summary, started_at, ended_at) values ($1, $2, $3, $4, 'completed', $5, $6, $7, $8, $8)", [
      id,
      organizationId,
      input.direction ?? "inbound",
      input.channel ?? "phone",
      input.from ?? null,
      input.to ?? null,
      input.summary ?? null,
      input.at,
    ]),
  );
  return id;
}
async function noteOf(organizationId: string, callId: string, text: string, at: Date, phone = PHONE): Promise<string> {
  const row = await withSystem(app, (q) =>
    q.one<{ id: string }>("insert into caller_notes (organization_id, call_id, caller_e164, text, created_at) values ($1, $2, $3, $4, $5) returning id", [organizationId, callId, phone, text, at]),
  );
  return row?.id ?? "";
}
async function followUpOf(organizationId: string, callId: string | null, title: string, at: Date, extra: { status?: "open" | "done"; details?: string; phone?: string } = {}): Promise<string> {
  const closed = extra.status === "done";
  const row = await withSystem(app, (q) =>
    q.one<{ id: string }>(
      "insert into follow_ups (organization_id, call_id, caller_e164, title, details, due_at, status, closed_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $6) returning id",
      [organizationId, callId, extra.phone ?? PHONE, title, extra.details ?? "", at, extra.status ?? "open", closed ? at : null],
    ),
  );
  return row?.id ?? "";
}
const setting = (organizationId: string, key: string, value: unknown) =>
  withSystem(app, (q) => q.exec("insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, false, $4)", [organizationId, key, JSON.stringify(value), NOW]));
const load = (organizationId: string, callId: string) => withOrg(app, organizationId, (q) => loadCallerMemory(q, { callId, now: NOW }));

describe("loadCallerMemory: o número e o que entra", () => {
  it("a recebida usa from_e164 e a de saída usa to_e164: o mesmo bloco nas duas direções", async () => {
    const org = await createOrganization(app, "load direcoes");
    const old = await callOf(org, { at: daysAgo(3), from: PHONE, to: LINE });
    const note = await noteOf(org, old, "Prefere de manhã.", daysAgo(3));
    const task = await followUpOf(org, old, "Confirmar o horário", daysAgo(3));

    const inbound = await callOf(org, { at: NOW, from: PHONE, to: LINE });
    const outbound = await callOf(org, { at: NOW, direction: "outbound", from: LINE, to: PHONE });
    const expected = {
      items: [
        { label: "nota", text: "Prefere de manhã." },
        { label: "pendência", text: "Confirmar o horário" },
      ],
      noteIds: [note],
      followUpIds: [task],
      chars: rememberedBlock([
        { label: "nota", text: "Prefere de manhã." },
        { label: "pendência", text: "Confirmar o horário" },
      ]).length,
      notes: [{ id: note, text: "Prefere de manhã." }],
      followUps: [{ id: task, title: "Confirmar o horário" }],
    };
    expect(await load(org, inbound)).toEqual(expected);
    expect(await load(org, outbound)).toEqual(expected);

    // A linha da empresa não é o número de quem ligou: a de saída para outro número não traz nada.
    const other = await callOf(org, { at: NOW, direction: "outbound", from: PHONE, to: "+5531911110000" });
    expect(await load(org, other)).toBeNull();
  });

  it("sem número, ou sem nota nem pendência aberta, não há bloco", async () => {
    const org = await createOrganization(app, "load vazio");
    const old = await callOf(org, { at: daysAgo(1), from: PHONE });
    await followUpOf(org, old, "Já resolvido", daysAgo(1), { status: "done" });
    expect(await load(org, await callOf(org, { at: NOW, from: null }))).toBeNull();
    expect(await load(org, await callOf(org, { at: NOW, from: PHONE }))).toBeNull();
  });

  it("nunca traz resumo, fala, detalhes da pendência nem pendência fechada", async () => {
    const org = await createOrganization(app, "load sem resumo");
    const old = await callOf(org, { at: daysAgo(2), from: PHONE, summary: "RESUMO-SECRETO do exame alterado" });
    await withSystem(app, (q) => q.exec("insert into call_events (organization_id, call_id, kind, payload, at) values ($1, $2, 'transcript_user', $3, $4)", [org, old, { text: "FALA-SECRETA" }, daysAgo(2)]));
    await followUpOf(org, old, "Retornar", daysAgo(2), { details: "DETALHE-SECRETO" });
    await followUpOf(org, old, "FECHADA-SECRETA", daysAgo(2), { status: "done" });
    const memory = await load(org, await callOf(org, { at: NOW, from: PHONE }));
    expect(memory?.items).toEqual([{ label: "pendência", text: "Retornar" }]);
    expect(JSON.stringify(memory)).not.toMatch(/SECRET/);
  });

  it("a nota e a pendência nascidas numa chamada simulada nunca entram; a pendência sem chamada entra", async () => {
    const org = await createOrganization(app, "load simulada");
    const simulated = await callOf(org, { at: daysAgo(1), from: PHONE, channel: "simulated" });
    await noteOf(org, simulated, "NOTA-SIMULADA", daysAgo(1));
    await followUpOf(org, simulated, "PENDENCIA-SIMULADA", daysAgo(1));
    const manual = await followUpOf(org, null, "Criada pela tela", daysAgo(1));
    const memory = await load(org, await callOf(org, { at: NOW, from: PHONE }));
    expect(memory?.items).toEqual([{ label: "pendência", text: "Criada pela tela" }]);
    expect(memory?.followUpIds).toEqual([manual]);
    expect(memory?.noteIds).toEqual([]);
  });

  it("o número sai do título da pendência que o supervisor abriu: o da ligação vira `este número`, outro vira `[número]`", async () => {
    const org = await createOrganization(app, "load sem numero no titulo");
    const old = await callOf(org, { at: daysAgo(1), from: PHONE });
    // O formato de `reviewTitle` (apps/routines/src/routines/review_call.ts): `Retornar para <número>: <o caso>`.
    const own = await followUpOf(org, old, `Retornar para ${PHONE}: a ligação caiu antes do fim`, daysAgo(1));
    const other = await followUpOf(org, old, "Avisar +5531900001111 do retorno", daysAgo(1, 1));
    const memory = await load(org, await callOf(org, { at: NOW, from: PHONE }));
    expect(memory?.items).toEqual([
      { label: "pendência", text: "Avisar [número] do retorno" },
      { label: "pendência", text: "Retornar para este número: a ligação caiu antes do fim" },
    ]);
    expect(memory?.followUpIds).toEqual([other, own]);
    expect(JSON.stringify(memory)).not.toContain(PHONE);
    expect(JSON.stringify(memory)).not.toContain("+5531900001111");
    expect(memory?.chars).toBe(rememberedBlock(memory?.items ?? []).length);
    // A tabela continua com o número: o dono precisa dele na tela.
    const stored = await withSystem(app, (q) => q.one<{ title: string }>("select title from follow_ups where id = $1", [own]));
    expect(stored?.title).toBe(`Retornar para ${PHONE}: a ligação caiu antes do fim`);
  });

  it("até 10 notas e 5 pendências, as mais novas, com as notas da mais nova para a mais velha", async () => {
    const org = await createOrganization(app, "load limites");
    const old = await callOf(org, { at: daysAgo(20), from: PHONE });
    for (let i = 0; i < CALLER_MEMORY_MAX_NOTES + 2; i += 1) await noteOf(org, old, `n${i}`, daysAgo(20 - i));
    for (let i = 0; i < CALLER_MEMORY_MAX_FOLLOW_UPS + 2; i += 1) await followUpOf(org, old, `p${i}`, daysAgo(20 - i));
    const memory = await load(org, await callOf(org, { at: NOW, from: PHONE }));
    expect(memory?.items.map((item) => item.text)).toEqual(["n11", "n10", "n9", "n8", "n7", "n6", "n5", "n4", "n3", "n2", "p6", "p5", "p4", "p3", "p2"]);
  });
});

describe("loadCallerMemory: isolamento, prazo e apagamento", () => {
  it("o mesmo número em duas organizações nunca mostra a nota nem a pendência da outra", async () => {
    const a = await createOrganization(app, "load isolamento a");
    const b = await createOrganization(app, "load isolamento b");
    await noteOf(a, await callOf(a, { at: daysAgo(1), from: PHONE }), "NOTA-DA-A", daysAgo(1));
    await followUpOf(a, null, "PENDENCIA-DA-A", daysAgo(1));
    await noteOf(b, await callOf(b, { at: daysAgo(1), from: PHONE }), "Nota da B", daysAgo(1));
    const memory = await load(b, await callOf(b, { at: NOW, from: PHONE }));
    expect(memory?.items).toEqual([{ label: "nota", text: "Nota da B" }]);
    expect(JSON.stringify(memory)).not.toMatch(/DA-A/);
    // Em transação de sistema a RLS não vale: a função recusa.
    await expect(withSystem(app, (q) => loadCallerMemory(q, { callId: randomUUID(), now: NOW }))).rejects.toThrow(/withOrg/);
  });

  it("a nota vencida pelo prazo nunca entra, mesmo antes de a rotina rodar; vale o menor prazo", async () => {
    const org = await createOrganization(app, "load prazo");
    const old = await callOf(org, { at: daysAgo(100), from: PHONE });
    await noteOf(org, old, "VENCIDA-DE-FABRICA", daysAgo(90, -1));
    await noteOf(org, old, "Dentro dos 90", daysAgo(90, 1));
    const current = await callOf(org, { at: NOW, from: PHONE });
    expect((await load(org, current))?.items.map((item) => item.text)).toEqual(["Dentro dos 90"]);

    // A transcrição guarda por 30 dias: o prazo efetivo cai para 30, sem esperar a rotina.
    await setting(org, TRANSCRIPT_RETENTION_SETTING, 30);
    await noteOf(org, old, "Dentro dos 30", daysAgo(30, 1));
    expect((await load(org, current))?.items.map((item) => item.text)).toEqual(["Dentro dos 30"]);

    // O prazo da memória gravado, menor que o da transcrição, também vale.
    await withSystem(app, (q) => q.exec("delete from settings where organization_id = $1", [org]));
    await setting(org, CALLER_NOTES_RETENTION_SETTING, 30);
    expect((await load(org, current))?.items.map((item) => item.text)).toEqual(["Dentro dos 30"]);
  });

  it("a nota apagada pela tela, pelo \"Esquecer este número\" ou a pedido do titular nunca entra", async () => {
    const org = await createOrganization(app, "load apagamento");
    const old = await callOf(org, { at: daysAgo(1), from: PHONE });
    const deleted = await noteOf(org, old, "APAGADA-PELA-TELA", daysAgo(1));
    await noteOf(org, old, "Fica", daysAgo(1, 1));
    const current = await callOf(org, { at: NOW, from: PHONE });
    await withOrg(app, org, (q) => deleteCallerNote(q, deleted));
    expect((await load(org, current))?.items).toEqual([{ label: "nota", text: "Fica" }]);

    await withOrg(app, org, (q) => forgetCaller(q, PHONE));
    expect(await load(org, current)).toBeNull();

    await noteOf(org, old, "APAGADA-A-PEDIDO", daysAgo(1));
    await followUpOf(org, old, "PENDENCIA-APAGADA-A-PEDIDO", daysAgo(1));
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-memoria-agente-"));
    try {
      // O titular pede o apagamento; depois liga de novo.
      expect(await withOrg(app, org, (q) => eraseCaller(q, { dir, phoneE164: PHONE, now: NOW }))).toMatchObject({ notes: 1 });
      const again = await callOf(org, { at: NOW, from: PHONE });
      expect(await load(org, again)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("o teto de 1 500 caracteres", () => {
  const notes = (count: number, text: (i: number) => string) => Array.from({ length: count }, (_, i) => ({ id: `n${i}`, text: text(i) }));
  const followUps = (count: number, title: (i: number) => string) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, title: title(i) }));

  it("corta a nota mais velha primeiro, depois o título mais velho, contando os literais escapados", async () => {
    // Notas da mais nova para a mais velha, como `loadCallerMemory` lê.
    const allNotes = notes(10, (i) => `${i}`.padEnd(300, "x"));
    const allFollowUps = followUps(5, (i) => `${i}`.padEnd(60, "y"));
    const fitted = fitCallerMemory(allNotes, allFollowUps);
    expect(fitted?.chars).toBeLessThanOrEqual(CALLER_MEMORY_MAX_CHARS);
    expect(fitted?.chars).toBe(rememberedBlock(fitted?.items ?? []).length);
    // Ficaram as notas mais novas, e mais uma não caberia; os títulos ficaram todos, porque o corte começa pelas notas.
    const kept = fitted?.noteIds.length ?? 0;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(10);
    expect(fitted?.noteIds).toEqual(allNotes.slice(0, kept).map((note) => note.id));
    expect(fitted?.followUpIds).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    const oneMore = [...allNotes.slice(0, kept + 1).map((note) => ({ label: "nota", text: note.text })), ...allFollowUps.map((item) => ({ label: "pendência", text: item.title }))];
    expect(rememberedBlock(oneMore).length).toBeGreaterThan(CALLER_MEMORY_MAX_CHARS);

    // `<` vira `<` (6 caracteres): uma nota de 300 deles passa sozinha do teto e sai; os títulos depois dela também são cortados do mais velho.
    const escaped = fitCallerMemory(notes(1, () => "<".repeat(300)), followUps(5, (i) => `${i}`.padEnd(80, "<")));
    expect(escaped?.noteIds).toEqual([]);
    expect(escaped?.followUpIds.length).toBeGreaterThan(0);
    expect(escaped?.followUpIds.length).toBeLessThan(5);
    expect(escaped?.followUpIds).toEqual(["p0", "p1", "p2", "p3", "p4"].slice(0, escaped?.followUpIds.length));
    expect(escaped?.chars).toBeLessThanOrEqual(CALLER_MEMORY_MAX_CHARS);
  });

  it("nada cabe: não há bloco", async () => {
    expect(fitCallerMemory(notes(1, () => "<".repeat(300)), [])).toBeNull();
  });
});
