// A exclusão de organização, o núcleo (R8, fatia 9b). Desenho:
// docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, 3.3, 3.11 e "Fatia 9".
//
// Banco real, com uma linha em cada tabela da organização (as fábricas de ./org-rows) e o WAHA falso.
// A outra organização é comparada linha a linha (`to_jsonb`), e não só pela contagem: um `update`
// numa linha dela não passa (ressalva S5b do Verificador no #480).
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, createAccount, findLoginAccount } from "../src/accounts";
import {
  endWhatsAppSessionUnlessUnused,
  executeOrganizationDeletion,
  requestOrganizationDeletion,
  type OrganizationDeletionDeps,
  type OrganizationDeletionStep,
  type RequestOrganizationDeletionResult,
} from "../src/installation";
import { reactivateOrganization } from "../src/suspension";
import { withSystem } from "../src/with-org";
import { openTestDbs } from "./helpers";
import { type Row, ident, insert, organizationFactories, spareAccounts } from "./org-rows";

const { app, owner } = openTestDbs();
const now = new Date("2026-11-19T12:00:00Z");
const REASON = "Contrato encerrado em novembro";

let recordings: string;
let actor: string;

// As tabelas que a cascata apaga, do catálogo: as que têm `organization_id` com chave em cascata.
const orgTables = (
  await owner.pool.query<{ name: string }>(`
    select c.conrelid::regclass::text as name
      from pg_constraint c
     where c.contype = 'f' and c.confrelid = 'public.organizations'::regclass and c.confdeltype = 'c'
       and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'organization_id' and not a.attisdropped)]
     order by 1`)
).rows.map((row) => row.name);

/**
 * O WAHA falso: anota cada organização cuja sessão foi desfeita. `down = "unreachable"` é o WAHA que
 * não responde (fora do ar, ou o perfil `whatsapp` desligado); `down = "error"`, o que responde com
 * erro (5xx, chave recusada).
 */
class FakeWahaError extends Error {
  constructor(readonly unreachable: boolean) {
    super(unreachable ? "Could not reach WAHA (POST /api/sessions/x/logout)" : "WAHA answered 500 to POST /api/sessions/x/logout");
  }
}
function fakeWaha() {
  const ended: string[] = [];
  const waha = {
    ended,
    down: false as false | "unreachable" | "error",
    endWhatsAppSession: (organizationId: string): Promise<void> =>
      // O mesmo caminho da rotina: o WAHA que não responde conta como feito se ninguém quer o serviço.
      endWhatsAppSessionUnlessUnused(
        app,
        async () => {
          if (waha.down) throw new FakeWahaError(waha.down === "unreachable");
          ended.push(organizationId);
        },
        (error) => error instanceof FakeWahaError && error.unreachable,
      ),
  };
  return waha;
}

const deps = (waha: ReturnType<typeof fakeWaha>, afterStep?: (step: OrganizationDeletionStep) => void): OrganizationDeletionDeps => ({
  db: app,
  clock: { now: () => now },
  recordingsDir: recordings,
  endWhatsAppSession: waha.endWhatsAppSession,
  afterStep,
});

const wantWhatsApp = (organizationId: string): Promise<unknown> =>
  owner.pool.query("update whatsapp_sessions set service_wanted = true where organization_id = $1", [organizationId]);

/**
 * Roda `fn` com nenhuma organização da instalação querendo o WhatsApp. O banco é um só para os
 * arquivos (em série): as linhas que outro arquivo deixou com `service_wanted` voltam como estavam.
 */
async function withNobodyWantingWhatsApp(fn: () => Promise<void>): Promise<void> {
  const { rows } = await owner.pool.query<{ id: string }>("update whatsapp_sessions set service_wanted = false where service_wanted returning id");
  try {
    await fn();
  } finally {
    await owner.pool.query("update whatsapp_sessions set service_wanted = true where id = any($1::uuid[])", [rows.map((row) => row.id)]);
  }
}

interface Org {
  id: string;
  name: string;
  rows: Record<string, Row>;
}

/** Uma organização com uma linha em cada tabela, e uma gravação na pasta dela. */
async function buildOrg(label: string, options: { suspended: boolean }): Promise<Org> {
  const id = randomUUID();
  const name = `${label} ${id.slice(0, 8)}`;
  // A conta da fábrica de `users` nasce aqui, e não numa reserva feita antes: uma conta de reserva é
  // uma conta sem vínculo, e a exclusão sabotada que apaga toda conta órfã a levaria junto.
  const factories = organizationFactories(await spareAccounts(app, 1, "organization-deletion.db.test.ts"));
  const rows: Record<string, Row> = {};
  await withSystem(app, async (q) => {
    await q.exec("insert into organizations (id, name, suspended_at, suspended_reason) values ($1, $2, $3, $4)", [
      id,
      name,
      options.suspended ? now : null,
      options.suspended ? "Pagamento em atraso há meses" : null,
    ]);
    for (const [table, factory] of Object.entries(factories)) rows[table] = await insert(q, table, factory(id, rows));
  });
  await mkdir(path.join(recordings, id), { recursive: true });
  await writeFile(path.join(recordings, id, `${randomUUID()}.wav`), "RIFF");
  return { id, name, rows };
}

const countsOf = async (organizationId: string): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const table of orgTables) {
    const { rows } = await owner.pool.query<{ n: number }>(`select count(*)::int as n from ${ident(table)} where organization_id = $1`, [organizationId]);
    counts[table] = rows[0]?.n ?? -1;
  }
  return counts;
};

/** O retrato de cada linha da organização, tabela por tabela, para comparar conteúdo e não só contagem. */
const snapshotOf = async (organizationId: string): Promise<Record<string, string[]>> => {
  const snapshot: Record<string, string[]> = {};
  for (const table of orgTables) {
    const { rows } = await owner.pool.query<{ row: string }>(`select to_jsonb(t)::text as row from ${ident(table)} t where t.organization_id = $1 order by 1`, [organizationId]);
    snapshot[table] = rows.map((row) => row.row);
  }
  return snapshot;
};

const exists = (dir: string): Promise<boolean> =>
  stat(dir).then(
    () => true,
    () => false,
  );
const orgRow = async (id: string) =>
  (
    await owner.pool.query<{ deleting_at: Date | null; deleting_reason: string | null; deleting_by: string | null }>(
      "select deleting_at, deleting_reason, deleting_by from organizations where id = $1",
      [id],
    )
  ).rows[0] ?? null;
const eventsOf = async (kind: string, organizationId: string) =>
  (
    await owner.pool.query<{ organization_id: string | null; actor_account_id: string | null; payload: Record<string, unknown> }>(
      "select organization_id, actor_account_id, payload from installation_events where kind = $1 and (organization_id = $2 or payload->>'organization_id' = $2::text) order by id",
      [kind, organizationId],
    )
  ).rows;

const request = (org: Org, overrides: Partial<{ typedName: string; reason: string }> = {}): Promise<RequestOrganizationDeletionResult> =>
  requestOrganizationDeletion(app, { organizationId: org.id, typedName: overrides.typedName ?? org.name, reason: overrides.reason ?? REASON, accountId: actor, now });

beforeAll(async () => {
  recordings = await mkdtemp(path.join(tmpdir(), "deskvoice-deletion-"));
  // Quem pede a exclusão: uma conta com a marca da instalação, sem vínculo nas organizações do teste.
  const id = await withSystem(app, (q) => createAccount(q, { email: `admin-${randomUUID()}@example.test`, passwordHash: "x" }));
  if (!id) throw new Error("account not created");
  await owner.pool.query("update accounts set installation_admin_at = $2 where id = $1", [id, now]);
  actor = id;
});
afterAll(async () => {
  // Nenhuma lápide fica para trás: o runner de outro arquivo a apagaria.
  const left = await owner.pool.query<{ id: string }>("select id from organizations where deleting_at is not null");
  for (const { id } of left.rows) await executeOrganizationDeletion(deps(fakeWaha()), id);
  await rm(recordings, { recursive: true, force: true });
  await app.close();
  await owner.close();
});

describe("requestOrganizationDeletion refuses, and a refusal writes nothing", () => {
  /** Pede, confere o motivo e confere que nem a lápide nem o evento foram gravados. */
  async function refused(org: Org | { id: string; name: string }, expected: string, overrides: Partial<{ typedName: string; reason: string }> = {}): Promise<void> {
    const events = (await eventsOf("organization_deletion_started", org.id)).length;
    const result = await requestOrganizationDeletion(app, {
      organizationId: org.id,
      typedName: overrides.typedName ?? org.name,
      reason: overrides.reason ?? REASON,
      accountId: actor,
      now,
    });
    expect(result).toEqual({ ok: false, reason: expected });
    const row = await orgRow(org.id);
    if (row && expected !== "already_deleting") expect(row).toEqual({ deleting_at: null, deleting_reason: null, deleting_by: null });
    expect(await eventsOf("organization_deletion_started", org.id)).toHaveLength(events);
  }

  it("not_found", async () => {
    await refused({ id: randomUUID(), name: "Ninguém" }, "not_found");
  });

  it("not_suspended", async () => {
    await refused(await buildOrg("Ativa", { suspended: false }), "not_suspended");
  });

  it("already_deleting, and the first tombstone is kept as it was", async () => {
    const org = await buildOrg("Já excluindo", { suspended: true });
    expect(await request(org)).toEqual({ ok: true });
    const tombstone = await orgRow(org.id);
    await refused(org, "already_deleting", { reason: "Outro motivo qualquer, mais tarde" });
    expect(await orgRow(org.id)).toEqual(tombstone);
    expect(await eventsOf("organization_deletion_started", org.id)).toHaveLength(1);
    await executeOrganizationDeletion(deps(fakeWaha()), org.id);
  });

  it("name_mismatch: the typed name must be the stored one, upper and lower case included", async () => {
    const org = await buildOrg("Clínica Sorriso", { suspended: true });
    await refused(org, "name_mismatch", { typedName: org.name.toLowerCase() });
    await refused(org, "name_mismatch", { typedName: `${org.name}x` });
    await refused(org, "name_mismatch", { typedName: "" });
  });

  it("invalid_reason: from 10 to 500 characters, after trimming", async () => {
    const org = await buildOrg("Motivo", { suspended: true });
    await refused(org, "invalid_reason", { reason: "  curto   " });
    await refused(org, "invalid_reason", { reason: "x".repeat(501) });
  });

  it("last_organization: never the last one without a tombstone", async () => {
    const org = await buildOrg("Última", { suspended: true });
    // Todas as outras do banco ganham lápide por um instante, e voltam como estavam.
    const others = (await owner.pool.query<{ id: string }>("update organizations set deleting_at = $2 where deleting_at is null and id <> $1 returning id", [org.id, now])).rows.map(
      (row) => row.id,
    );
    try {
      await refused(org, "last_organization");
    } finally {
      await owner.pool.query("update organizations set deleting_at = null where id = any($1::uuid[])", [others]);
    }
  });

  it("update_request_open: a requested or running update of the organization (3.11)", async () => {
    const org = await buildOrg("Atualizando", { suspended: true });
    for (const status of ["requested", "running"]) {
      const { rows } = await owner.pool.query<{ id: string }>(
        "insert into update_requests (organization_id, requested_by, status, from_version, target_version) values ($1, $2, $3, '0.1.0', '0.2.0') returning id",
        [org.id, org.rows.users?.id, status],
      );
      try {
        await refused(org, "update_request_open");
      } finally {
        await owner.pool.query("delete from update_requests where id = $1", [rows[0]?.id]);
      }
    }
  });
});

describe("a tombstoned organization", () => {
  it("cannot be reactivated: there is no undoing the deletion", async () => {
    const org = await buildOrg("Sem volta", { suspended: true });
    expect(await request(org)).toEqual({ ok: true });
    expect(await reactivateOrganization(app, { organizationId: org.id, actorAccountId: actor }, now)).toEqual({ ok: false, reason: "deleting" });
    expect(await orgRow(org.id)).toMatchObject({ deleting_at: now });
    await executeOrganizationDeletion(deps(fakeWaha()), org.id);
  });

  it("an organization without a tombstone is never touched: not WAHA, not the recordings, not the database", async () => {
    const org = await buildOrg("Ativa intocada", { suspended: true });
    const waha = fakeWaha();
    const before = await snapshotOf(org.id);
    expect(await executeOrganizationDeletion(deps(waha), org.id)).toEqual({ status: "nothing_to_do" });
    expect(waha.ended).toEqual([]);
    expect(await exists(path.join(recordings, org.id))).toBe(true);
    expect(await snapshotOf(org.id)).toEqual(before);
  });

  it("a tombstone taken off in the middle (by SQL) holds the delete back", async () => {
    const org = await buildOrg("Lápide tirada", { suspended: true });
    expect(await request(org)).toEqual({ ok: true });
    const before = await snapshotOf(org.id);
    const result = await executeOrganizationDeletion(
      {
        ...deps(fakeWaha()),
        afterStep: async (step) => {
          if (step === 3) await owner.pool.query("update organizations set deleting_at = null where id = $1", [org.id]);
        },
      },
      org.id,
    );
    expect(result).toEqual({ status: "nothing_to_do" });
    expect(await snapshotOf(org.id)).toEqual(before);
    expect(await eventsOf("organization_deleted", org.id)).toEqual([]);
  });
});

/** O que o aceite confere depois da exclusão: nada da A, a B igual, a pasta da B, um evento só. */
async function expectDeleted(a: Org, b: { org: Org; snapshot: Record<string, string[]> }, countsA: Record<string, number>): Promise<void> {
  expect(await countsOf(a.id)).toEqual(Object.fromEntries(orgTables.map((table) => [table, 0])));
  expect(await orgRow(a.id)).toBeNull();
  expect(await exists(path.join(recordings, a.id))).toBe(false);
  expect(await snapshotOf(b.org.id)).toEqual(b.snapshot);
  expect(await exists(path.join(recordings, b.org.id))).toBe(true);
  const deleted = await eventsOf("organization_deleted", a.id);
  expect(deleted).toHaveLength(1);
  expect(deleted[0]).toMatchObject({
    organization_id: null,
    actor_account_id: actor,
    payload: { organization_id: a.id, name: a.name, reason: REASON, counts: countsA },
  });
  // Nem e-mail de conta nem dado de quem ligou: só nome, motivo, contagens e quantidades.
  expect(JSON.stringify(deleted[0]?.payload)).not.toMatch(/@|\+55/);
}

describe("executeOrganizationDeletion", () => {
  it("deletes every row of A in every table, its recordings and its WhatsApp session, and leaves B exactly as it was", async () => {
    const a = await buildOrg("Aceite A", { suspended: true });
    const b = await buildOrg("Aceite B", { suspended: false });
    const countsA = await countsOf(a.id);
    // Cada tabela tem linha das duas antes: senão o depois não prova nada.
    expect(Object.entries(countsA).filter(([, n]) => n < 1)).toEqual([]);
    expect(Object.entries(await countsOf(b.id)).filter(([, n]) => n < 1)).toEqual([]);
    const snapshot = await snapshotOf(b.id);

    // O nome digitado vale depois de tirar os espaços das pontas.
    expect(await request(a, { typedName: `  ${a.name}  ` })).toEqual({ ok: true });
    expect(await orgRow(a.id)).toEqual({ deleting_at: now, deleting_reason: REASON, deleting_by: actor });
    expect(await eventsOf("organization_deletion_started", a.id)).toEqual([
      { organization_id: a.id, actor_account_id: actor, payload: { name: a.name, reason: REASON } },
    ]);

    const waha = fakeWaha();
    const result = await executeOrganizationDeletion(deps(waha), a.id);
    expect(result).toMatchObject({ status: "deleted", counts: countsA });
    expect(waha.ended).toEqual([a.id]);
    await expectDeleted(a, { org: b, snapshot }, countsA);
    // A organização que já saiu não tem mais o que fazer.
    expect(await executeOrganizationDeletion(deps(waha), a.id)).toEqual({ status: "nothing_to_do" });
    expect(waha.ended).toEqual([a.id]);
  });

  it.each([2, 3, 4, 5] as const)("an interruption after step %i, and a second call, ends the same way with a single event", async (step) => {
    const a = await buildOrg(`Retomada ${step} A`, { suspended: true });
    const b = await buildOrg(`Retomada ${step} B`, { suspended: false });
    const countsA = await countsOf(a.id);
    const snapshot = await snapshotOf(b.id);
    expect(await request(a)).toEqual({ ok: true });

    const waha = fakeWaha();
    const interrupted = executeOrganizationDeletion(
      deps(waha, (at) => {
        if (at === step) throw new Error(`interrupted after step ${at}`);
      }),
      a.id,
    );
    await expect(interrupted).rejects.toThrow(`interrupted after step ${step}`);
    // O banco não perdeu nada: os passos 4 e 5 voltam junto com a transação deles.
    expect(await countsOf(a.id)).toEqual(countsA);
    expect(await eventsOf("organization_deleted", a.id)).toEqual([]);

    expect(await executeOrganizationDeletion(deps(waha), a.id)).toMatchObject({ status: "deleted", counts: countsA });
    await expectDeleted(a, { org: b, snapshot }, countsA);
  });

  // W2 (ajuste 1 da 9b), e o teste "WAHA fora" do desenho: com alguma organização querendo o serviço.
  it("W2: with WAHA not answering and B wanting WhatsApp, it stops before the database; when WAHA is back, it finishes", async () => {
    const a = await buildOrg("WAHA fora A", { suspended: true });
    const b = await buildOrg("WAHA fora B", { suspended: false });
    await wantWhatsApp(b.id);
    const countsA = await countsOf(a.id);
    const snapshot = await snapshotOf(b.id);
    expect(await request(a)).toEqual({ ok: true });

    const waha = fakeWaha();
    waha.down = "unreachable";
    expect(await executeOrganizationDeletion(deps(waha), a.id)).toEqual({ status: "retry", step: "whatsapp", error: expect.stringContaining("Could not reach WAHA") });
    expect(await countsOf(a.id)).toEqual(countsA);
    expect(await orgRow(a.id)).toMatchObject({ deleting_at: now });
    expect(await exists(path.join(recordings, a.id))).toBe(true);
    expect(await eventsOf("organization_deleted", a.id)).toEqual([]);

    waha.down = false;
    expect(await executeOrganizationDeletion(deps(waha), a.id)).toMatchObject({ status: "deleted" });
    expect(waha.ended).toEqual([a.id]);
    await expectDeleted(a, { org: b, snapshot }, countsA);
  });

  it("W1: with WAHA not answering and nobody wanting WhatsApp, the deletion finishes", async () => {
    await withNobodyWantingWhatsApp(async () => {
      const a = await buildOrg("WAHA desligado A", { suspended: true });
      const b = await buildOrg("WAHA desligado B", { suspended: false });
      const countsA = await countsOf(a.id);
      const snapshot = await snapshotOf(b.id);
      expect(await request(a)).toEqual({ ok: true });

      const waha = fakeWaha();
      waha.down = "unreachable";
      expect(await executeOrganizationDeletion(deps(waha), a.id)).toMatchObject({ status: "deleted", counts: countsA });
      expect(waha.ended).toEqual([]);
      await expectDeleted(a, { org: b, snapshot }, countsA);
    });
  });

  it("W3: with WAHA not answering and only A itself (the tombstoned one) wanting WhatsApp, it stops before the database", async () => {
    await withNobodyWantingWhatsApp(async () => {
      const a = await buildOrg("WAHA fora só A", { suspended: true });
      await wantWhatsApp(a.id);
      const countsA = await countsOf(a.id);
      expect(await request(a)).toEqual({ ok: true });

      const waha = fakeWaha();
      waha.down = "unreachable";
      expect(await executeOrganizationDeletion(deps(waha), a.id)).toEqual({ status: "retry", step: "whatsapp", error: expect.stringContaining("Could not reach WAHA") });
      expect(await countsOf(a.id)).toEqual(countsA);
      expect(await exists(path.join(recordings, a.id))).toBe(true);

      // Deixa a instalação sem lápide pendente para os outros testes.
      waha.down = false;
      expect(await executeOrganizationDeletion(deps(waha), a.id)).toMatchObject({ status: "deleted" });
    });
  });

  it("with WAHA answering an error (5xx, refused key) and nobody wanting WhatsApp, it still stops before the database", async () => {
    await withNobodyWantingWhatsApp(async () => {
      const a = await buildOrg("WAHA erro A", { suspended: true });
      const countsA = await countsOf(a.id);
      expect(await request(a)).toEqual({ ok: true });

      const waha = fakeWaha();
      waha.down = "error";
      expect(await executeOrganizationDeletion(deps(waha), a.id)).toEqual({ status: "retry", step: "whatsapp", error: expect.stringContaining("WAHA answered 500") });
      expect(await countsOf(a.id)).toEqual(countsA);

      waha.down = false;
      expect(await executeOrganizationDeletion(deps(waha), a.id)).toMatchObject({ status: "deleted" });
    });
  });

  it("deletes only the accounts of A that were left with no link and without the installation mark", async () => {
    const a = await buildOrg("Contas A", { suspended: true });
    const b = await buildOrg("Contas B", { suspended: false });
    const account = async (): Promise<string> => {
      const id = await withSystem(app, (q) => createAccount(q, { email: `conta-${randomUUID()}@example.test`, passwordHash: "x" }));
      if (!id) throw new Error("account not created");
      return id;
    };
    const join = (organizationId: string, accountId: string): Promise<string> =>
      withSystem(app, (q) => addMembership(q, { organizationId, accountId, name: "Pessoa", role: "operator" }));

    const onlyA = await account();
    await join(a.id, onlyA);
    const both = await account();
    await join(b.id, both);
    await join(a.id, both);
    await owner.pool.query("update accounts set last_organization_id = $2 where id = $1", [both, a.id]);
    const adminOnlyA = await account();
    await join(a.id, adminOnlyA);
    await owner.pool.query("update accounts set installation_admin_at = $2 where id = $1", [adminOnlyA, now]);
    // Sem vínculo nenhum desde antes: não é da A, e a exclusão não a apaga.
    const lone = await account();
    // A conta da fábrica de `users` da A também é só dela.
    const factoryA = String(a.rows.users?.account_id);
    const snapshot = await snapshotOf(b.id);

    expect(await request(a)).toEqual({ ok: true });
    expect(await executeOrganizationDeletion(deps(fakeWaha()), a.id)).toMatchObject({ status: "deleted", deletedAccounts: 2 });

    const left = (await owner.pool.query<{ id: string; last_organization_id: string | null }>("select id, last_organization_id from accounts where id = any($1::uuid[])", [
      [onlyA, both, adminOnlyA, lone, factoryA],
    ])).rows;
    expect(Object.fromEntries(left.map((row) => [row.id, row.last_organization_id]))).toEqual({ [both]: null, [adminOnlyA]: null, [lone]: null });
    // A conta da A e da B entra na B.
    const email = (await owner.pool.query<{ email: string }>("select email from accounts where id = $1", [both])).rows[0]?.email ?? "";
    expect((await findLoginAccount(app, email))?.member?.organizationId).toBe(b.id);
    expect((await eventsOf("organization_deleted", a.id))[0]?.payload).toMatchObject({ deleted_accounts: 2 });
    // A B só ganhou nada e perdeu nada: o vínculo dela com a conta das duas continua igual.
    expect(await snapshotOf(b.id)).toEqual(snapshot);
  });
});

// A ligação pelo WhatsApp (fatia 9b2): só o processo de voz tem o token do WaCalls, e a rotina espera
// a linha de `whatsapp_call_sessions` ficar sem `wacalls_session_id`.
describe("executeOrganizationDeletion waits for the voice process to unpair WhatsApp calls", () => {
  const pairCalls = (organizationId: string): Promise<unknown> =>
    owner.pool.query("update whatsapp_call_sessions set wacalls_session_id = 's-pareada', status = 'connected', phone_e164 = '+553133330000' where organization_id = $1", [organizationId]);

  it("E1: with wacalls_session_id set, it returns retry / whatsapp_calls; the database and the folder of A are intact, and WAHA was already undone", async () => {
    const a = await buildOrg("WaCalls pareado A", { suspended: true });
    await pairCalls(a.id);
    const before = await snapshotOf(a.id);
    expect(await request(a)).toEqual({ ok: true });

    const waha = fakeWaha();
    expect(await executeOrganizationDeletion(deps(waha), a.id)).toEqual({ status: "retry", step: "whatsapp_calls", error: "waiting for the voice process to unpair WhatsApp calls" });
    expect(waha.ended).toEqual([a.id]);
    expect(await snapshotOf(a.id)).toEqual(before);
    expect(await orgRow(a.id)).toMatchObject({ deleting_at: now });
    expect(await exists(path.join(recordings, a.id))).toBe(true);
    expect(await eventsOf("organization_deleted", a.id)).toEqual([]);

    // E2: o processo de voz limpou a linha; a mesma chamada termina, com um evento só.
    await owner.pool.query("update whatsapp_call_sessions set wacalls_session_id = null, status = 'disconnected', phone_e164 = null where organization_id = $1", [a.id]);
    expect(await executeOrganizationDeletion(deps(waha), a.id)).toMatchObject({ status: "deleted" });
    expect(await orgRow(a.id)).toBeNull();
    expect(await eventsOf("organization_deleted", a.id)).toHaveLength(1);
  });

  it("E3: a row without wacalls_session_id, or no row at all, does not hold the deletion back", async () => {
    const withNull = await buildOrg("WaCalls nulo", { suspended: true });
    const withoutRow = await buildOrg("WaCalls sem linha", { suspended: true });
    await owner.pool.query("delete from whatsapp_call_sessions where organization_id = $1", [withoutRow.id]);
    for (const org of [withNull, withoutRow]) {
      expect(await request(org)).toEqual({ ok: true });
      expect(await executeOrganizationDeletion(deps(fakeWaha()), org.id)).toMatchObject({ status: "deleted" });
      expect(await eventsOf("organization_deleted", org.id)).toHaveLength(1);
    }
  });
});
