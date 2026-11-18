import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "../src/accounts";
import type { OrgQuery } from "../src/types";
import { createDb } from "../src/db";
import { withOrg, withSystem } from "../src/with-org";
import { createOrganization, openTestDbs } from "./helpers";

type Row = Record<string, unknown>;
/** Monta uma linha válida da tabela para a organização, apontando para linhas já criadas dela. */
type Factory = (organizationId: string, parents: Record<string, Row>) => Row;

const at = new Date("2026-01-15T12:00:00Z");
const unique = (prefix: string): string => `${prefix}-${randomUUID()}`;

// A conta não pertence a organização nenhuma e só o papel de sistema a cria: a fábrica de `users`
// pega uma destas, feitas antes. Cada vínculo precisa de uma conta própria (`users_one_membership_idx`
// e o e-mail único).
const { app, owner } = openTestDbs();
const spareAccounts: string[] = [];
for (let i = 0; i < 6; i++) {
  const id = await withSystem(app, (q) => createAccount(q, { email: `${unique("account")}@example.com`, passwordHash: "x" }));
  if (!id) throw new Error("could not create a test account");
  spareAccounts.push(id);
}
const nextAccount = (): string => {
  const id = spareAccounts.pop();
  if (!id) throw new Error("isolation.db.test.ts ran out of spare accounts: create more above");
  return id;
};

// Uma fábrica por tabela com `organization_id`, em ordem de dependência. Tabela nova sem fábrica
// reprova este arquivo: é assim que ela é obrigada a entrar no teste de isolamento.
const factories: Record<string, Factory> = {
  users: (organization_id) => ({ organization_id, account_id: nextAccount(), email: `${unique("user")}@example.com`, name: "User", role: "owner" }),
  sessions: (organization_id, p) => ({ organization_id, user_id: p.users?.id, account_id: p.users?.account_id, token_hash: unique("token"), expires_at: at }),
  // O vínculo de suporte de verdade nasce por `startSupportAccess`; aqui basta um vínculo da organização.
  support_accesses: (organization_id, p) => ({
    organization_id,
    user_id: p.users?.id,
    reason: "Ajuda com a linha da operadora",
    started_at: at,
    expires_at: new Date(at.getTime() + 15 * 60_000),
  }),
  invites: (organization_id, p) => ({ organization_id, email: `${unique("invite")}@example.com`, name: "Invited", role: "operator", token_hash: unique("invite-token"), expires_at: at, created_by: p.users?.id }),
  settings: (organization_id) => ({ organization_id, key: unique("key"), value: { on: true } }),
  trunks: (organization_id) => ({ organization_id, name: "Trunk", host: "sip.example.com", auth_mode: "register" }),
  analysts: (organization_id, p) => ({
    organization_id,
    name: unique("analyst").slice(0, 40),
    decision_model: "jev",
    provider_confirmed_by: p.users?.id,
    provider_confirmed_at: at,
    created_at: at,
    updated_at: at,
  }),
  agents: (organization_id, p) => ({ organization_id, name: "Agent", engine: "simulated", analyst_id: p.analysts?.id }),
  phone_numbers: (organization_id, p) => ({ organization_id, trunk_id: p.trunks?.id, e164: `+55${Math.floor(1e10 + Math.random() * 9e10)}`, agent_id: p.agents?.id }),
  // O menu por teclas (#223). O anúncio vai junto: é o `bytea` que a RLS tem de esconder da outra organização.
  ivr_menus: (organization_id) => ({ organization_id, name: "Menu", prompt_audio: Buffer.alloc(16), prompt_audio_ms: 1, created_at: at, updated_at: at }),
  ivr_options: (organization_id, p) => ({ organization_id, menu_id: p.ivr_menus?.id, digit: "1", label: "Atendente", action: "agent", agent_id: p.agents?.id }),
  calls: (organization_id, p) => ({ organization_id, agent_id: p.agents?.id, direction: "inbound", channel: "phone", status: "ringing", started_at: at }),
  call_events: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, at, kind: "call_started", payload: {} }),
  approvals: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, question: "Pode?", default_on_timeout: "denied", expires_at: at }),
  tasks: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, kind: "isolation_probe", payload: {}, status: "done" }),
  follow_ups: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, title: "Retornar", owner_user_id: p.users?.id, due_at: at, created_at: at }),
  notifications: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, follow_up_id: p.follow_ups?.id, channel: "panel", body: "Aviso" }),
  caller_notes: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, caller_e164: "+5531999990000", text: "Nota", created_at: at }),
  outbound_policy: (organization_id) => ({ organization_id }),
  do_not_call: (organization_id) => ({ organization_id, e164: `+55${Math.floor(1e10 + Math.random() * 9e10)}` }),
  usage_ledger: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, engine: "simulated", at }),
  // Encerrado de propósito: só cabe um pedido ABERTO na instalação inteira, e aqui há duas organizações.
  update_requests: (organization_id, p) => ({ organization_id, requested_by: p.users?.id, status: "succeeded", from_version: "0.1.0", target_version: "0.2.0" }),
  update_agent_status: (organization_id) => ({ organization_id, last_seen_at: at, announced_version: "0.1.0" }),
  whatsapp_sessions: (organization_id) => ({ organization_id, session_name: unique("session") }),
  whatsapp_call_sessions: (organization_id) => ({ organization_id, session_name: unique("call-session") }),
  organization_events: (organization_id, p) => ({ organization_id, at, kind: "isolation_probe", actor_user_id: p.users?.id, payload: {} }),
  share_links: (organization_id, p) => ({
    organization_id,
    call_id: p.calls?.id,
    token_hash: unique("share-token"),
    kind: "recording",
    expires_at: at,
    max_uses: 10,
    created_by: p.users?.id,
    created_at: at,
  }),
};

// Tabelas da INSTALAÇÃO (R8, seção 3.9): sem `organization_id`, com RLS forçado e sem policy, e sem
// nenhum direito para `deskvoice_app`. A senha de todas as contas nunca fica ao alcance de uma rota
// presa a uma organização. O papel de sistema lê e acrescenta; nenhuma delas se apaga por ele.
const INSTALLATION_TABLES = ["accounts", "installation_settings", "installation_events"];
const UNSCOPED_TABLES = ["organizations", "schema_migrations", ...INSTALLATION_TABLES];
const RLS_VIOLATION = "42501";

// Tabelas só de acréscimo: os papéis de aplicação e de sistema leem e inserem, e nunca alteram nem
// apagam. Para elas, os testes de isolamento abaixo conferem a recusa da permissão no lugar da
// alteração; todas as outras continuam provando que a dona altera e apaga as próprias linhas.
// Entrada nova precisa de motivo, e o teste de schema reprova lista que não bate com as permissões.
const APPEND_ONLY_TABLES: Record<string, string> = {
  organization_events: "auditoria dos direitos de quem ligou (registro 0014): registro que se reescreve não prova nada",
};
const isAppendOnly = (table: string): boolean => Object.hasOwn(APPEND_ONLY_TABLES, table);
const PERMISSION_DENIED = { code: "42501", message: expect.stringMatching(/permission denied/) };

// A lista de tabelas vem do catálogo do Postgres, nunca de lista escrita à mão.
const catalog = await owner.pool.query<{ name: string; has_org: boolean; rls: boolean; forced: boolean; pk: string[] }>(`
  select c.relname as name,
         exists (select from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped) as has_org,
         c.relrowsecurity as rls,
         c.relforcerowsecurity as forced,
         coalesce((select array_agg(a.attname::text order by a.attnum)
                     from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                    where i.indrelid = c.oid and i.indisprimary), '{}') as pk
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
   order by c.relname`);
const tables = catalog.rows;
// `installation_events.organization_id` existe, mas aceita nulo e não isola nada: o registro é da
// instalação e sobrevive à exclusão da organização. As tabelas da instalação ficam fora das escopadas.
const scoped = tables.filter((t) => t.has_org && !INSTALLATION_TABLES.includes(t.name));
const pkOf = new Map(tables.map((t) => [t.name, t.pk]));

const ident = (name: string): string => `"${name.replaceAll('"', '""')}"`;

async function insert(q: OrgQuery, table: string, row: Row): Promise<Row> {
  const columns = Object.keys(row);
  const inserted = await q.one(
    `insert into ${ident(table)} (${columns.map(ident).join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    Object.values(row),
  );
  if (!inserted) throw new Error(`insert into ${table} returned no row`);
  return inserted;
}

/** `where` que identifica a linha pela chave primária lida do catálogo. */
function byPk(table: string, row: Row, firstParam = 1): { where: string; params: unknown[] } {
  const pk = pkOf.get(table) ?? [];
  if (pk.length === 0) throw new Error(`table ${table} has no primary key`);
  return { where: pk.map((column, i) => `${ident(column)} = $${firstParam + i}`).join(" and "), params: pk.map((column) => row[column]) };
}

async function count(q: OrgQuery, table: string, where: string, params: unknown[]): Promise<number> {
  const row = await q.one<{ n: number }>(`select count(*)::int as n from ${ident(table)} where ${where}`, params);
  return row?.n ?? -1;
}

function factoryFor(table: string): Factory {
  const factory = factories[table];
  if (!factory) {
    throw new Error(`Table "${table}" has organization_id but no factory in isolation.db.test.ts: add one so its isolation is tested`);
  }
  return factory;
}

let orgA: string;
let orgB: string;
const rowsA: Record<string, Row> = {};
const rowsB: Record<string, Row> = {};

beforeAll(async () => {
  orgA = await createOrganization(app, "isolation A");
  orgB = await createOrganization(app, "isolation B");
  const known = new Set(scoped.map((t) => t.name));
  for (const [organizationId, rows] of [[orgA, rowsA], [orgB, rowsB]] as const) {
    await withOrg(app, organizationId, async (q) => {
      for (const [table, factory] of Object.entries(factories)) {
        if (known.has(table)) rows[table] = await insert(q, table, factory(organizationId, rows));
      }
    });
  }
});

afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("schema", () => {
  it("runs the tests as an application role that cannot bypass RLS", async () => {
    const role = await app.pool.query<{ name: string; rolsuper: boolean; rolbypassrls: boolean }>(
      "select current_user::text as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(role.rows).toEqual([{ name: "deskvoice_app", rolsuper: false, rolbypassrls: false }]);
  });

  it("finds the tables in the catalog", () => {
    expect(scoped.length).toBeGreaterThanOrEqual(14);
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(UNSCOPED_TABLES));
  });

  it("has organization_id on every table except organizations, schema_migrations and the installation tables", () => {
    expect(tables.filter((t) => !scoped.includes(t)).map((t) => t.name).sort()).toEqual([...UNSCOPED_TABLES].sort());
    // Fora as da instalação, só `organizations` e `schema_migrations` ficam sem `organization_id`.
    expect(tables.filter((t) => !t.has_org && !INSTALLATION_TABLES.includes(t.name)).map((t) => t.name).sort()).toEqual(["organizations", "schema_migrations"]);
  });

  it("forces row level security on every product table", () => {
    const unprotected = tables.filter((t) => t.name !== "schema_migrations" && !(t.rls && t.forced)).map((t) => t.name);
    expect(unprotected).toEqual([]);
  });

  it("keeps the migration ledger out of reach of the application and system roles", async () => {
    await expect(app.pool.query("select 1 from schema_migrations")).rejects.toMatchObject({ code: "42501" });
    await expect(withSystem(app, (q) => q.many("select 1 from schema_migrations"))).rejects.toMatchObject({ code: "42501" });
  });

  it("has a separate system role that bypasses RLS without being superuser", async () => {
    const role = await withSystem(app, (q) =>
      q.one("select current_user::text as name, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = current_user"),
    );
    expect(role).toEqual({ name: "deskvoice_system", rolsuper: false, rolbypassrls: true, rolcreaterole: false, rolcreatedb: false });
  });

  it("does not make the application role a member of any role", async () => {
    const memberships = await owner.pool.query(
      "select roleid::regrole::text as role from pg_auth_members where member = 'deskvoice_app'::regrole",
    );
    expect(memberships.rows).toEqual([]);
  });

  it("has no policy that reads a session switch other than the organization id", async () => {
    const policies = await owner.pool.query<{ tablename: string; qual: string; with_check: string }>(
      "select tablename::text, qual, with_check from pg_policies where schemaname = 'public'",
    );
    expect(policies.rows.length).toBe(scoped.length + 1);
    for (const policy of policies.rows) {
      const column = policy.tablename === "organizations" ? "id" : "organization_id";
      const expected = `(${column} = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)`;
      expect(policy.qual, policy.tablename).toBe(expected);
      expect(policy.with_check, policy.tablename).toBe(expected);
    }
  });

  it("grants change and delete on every table with organization_id except the append-only ones, which only read and insert", async () => {
    expect(Object.keys(APPEND_ONLY_TABLES).filter((name) => !scoped.some((t) => t.name === name))).toEqual([]);
    for (const [name, reason] of Object.entries(APPEND_ONLY_TABLES)) expect(reason.trim(), name).not.toBe("");
    const privileges = await owner.pool.query<{ name: string; role: string; can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }>(
      `select t.name, r.role,
              has_table_privilege(r.role, format('public.%I', t.name), 'select') as can_select,
              has_table_privilege(r.role, format('public.%I', t.name), 'insert') as can_insert,
              has_table_privilege(r.role, format('public.%I', t.name), 'update') as can_update,
              has_table_privilege(r.role, format('public.%I', t.name), 'delete') as can_delete
         from unnest($1::text[]) as t(name), unnest(array['deskvoice_app', 'deskvoice_system']) as r(role)`,
      [scoped.map((t) => t.name)],
    );
    for (const row of privileges.rows) {
      const changes = !isAppendOnly(row.name);
      expect([row.can_select, row.can_insert, row.can_update, row.can_delete], `${row.name} as ${row.role}`).toEqual([true, true, changes, changes]);
    }
  });

  it("keeps the installation tables out of reach of the application role, and lets the system role only read and add (and drop an account left without a link, and change a setting's value but never its key)", async () => {
    const privileges = await owner.pool.query<{ name: string; role: string; can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean; can_truncate: boolean }>(
      `select t.name, r.role,
              has_table_privilege(r.role, format('public.%I', t.name), 'select') as can_select,
              has_table_privilege(r.role, format('public.%I', t.name), 'insert') as can_insert,
              has_table_privilege(r.role, format('public.%I', t.name), 'update') as can_update,
              has_table_privilege(r.role, format('public.%I', t.name), 'delete') as can_delete,
              has_table_privilege(r.role, format('public.%I', t.name), 'truncate') as can_truncate
         from unnest($1::text[]) as t(name), unnest(array['deskvoice_app', 'deskvoice_system']) as r(role)`,
      [INSTALLATION_TABLES],
    );
    // A conta muda (senha, marca); a auditoria só cresce. A configuração muda só no valor, e por
    // coluna: a tabela inteira fica sem `update` (conferido logo abaixo, coluna por coluna).
    const SYSTEM_UPDATES: Record<string, boolean> = { accounts: true, installation_settings: false, installation_events: false };
    // Só a conta sai, e só quando fica sem vínculo (`deleteAccountIfOrphan`). A configuração e a
    // auditoria nunca são apagadas pelo produto.
    const SYSTEM_DELETES: Record<string, boolean> = { accounts: true, installation_settings: false, installation_events: false };
    expect(privileges.rows).toHaveLength(INSTALLATION_TABLES.length * 2);
    for (const row of privileges.rows) {
      const expected = row.role === "deskvoice_app" ? [false, false, false, false, false] : [true, true, SYSTEM_UPDATES[row.name], SYSTEM_DELETES[row.name], false];
      expect([row.can_select, row.can_insert, row.can_update, row.can_delete, row.can_truncate], `${row.name} as ${row.role}`).toEqual(expected);
    }
    // O papel de sistema muda o valor de uma configuração, nunca a chave: trocar a chave de
    // `installation.admins_explicit_at` desfaria a lista explícita sem apagar a linha (seção 3.2).
    const columns = await owner.pool.query<{ name: string; role: string; can_update: boolean }>(
      `select c.name, r.role, has_column_privilege(r.role, 'public.installation_settings', c.name, 'update') as can_update
         from unnest(array['key', 'value', 'secret', 'updated_at']) as c(name), unnest(array['deskvoice_app', 'deskvoice_system']) as r(role)
        order by r.role, c.name`,
    );
    expect(columns.rows.map((row) => `${row.role}.${row.name}=${row.can_update}`)).toEqual([
      "deskvoice_app.key=false",
      "deskvoice_app.secret=false",
      "deskvoice_app.updated_at=false",
      "deskvoice_app.value=false",
      "deskvoice_system.key=false",
      "deskvoice_system.secret=false",
      "deskvoice_system.updated_at=true",
      "deskvoice_system.value=true",
    ]);
    // Sem policy: um `grant` dado por engano ao papel de aplicação continuaria sem linha visível.
    for (const table of INSTALLATION_TABLES) expect(tables.find((t) => t.name === table), table).toMatchObject({ rls: true, forced: true });
  });

  it("refuses to show any account, password included, to the application role, inside or outside an organization", async () => {
    await expect(app.pool.query("select email, password_hash from accounts")).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(withOrg(app, orgA, (q) => q.many("select password_hash from accounts"))).rejects.toMatchObject(PERMISSION_DENIED);
    for (const table of ["installation_settings", "installation_events"]) {
      await expect(withOrg(app, orgA, (q) => q.many(`select * from ${ident(table)}`))).rejects.toMatchObject(PERMISSION_DENIED);
    }
    // O vínculo continua visível pela organização, sem senha: a coluna saiu de `users`.
    const columns = await owner.pool.query<{ name: string }>("select column_name::text as name from information_schema.columns where table_schema = 'public' and table_name = 'users'");
    expect(columns.rows.map((c) => c.name)).not.toContain("password_hash");
    expect(columns.rows.map((c) => c.name)).toEqual(expect.arrayContaining(["account_id", "kind"]));
  });

  it("has a factory for every table with organization_id, and no stale factory", () => {
    expect(scoped.map((t) => t.name).filter((name) => !(name in factories))).toEqual([]);
    expect(Object.keys(factories).filter((name) => !scoped.some((t) => t.name === name))).toEqual([]);
  });
});

describe.each(scoped.map((t) => t.name))("isolation of %s", (table) => {
  it("lets the owning organization read and change its own row", async () => {
    factoryFor(table);
    const { where, params } = byPk(table, rowsA[table] ?? {});
    const change = (q: OrgQuery) => q.exec(`update ${ident(table)} set organization_id = organization_id where ${where}`, params);
    await withOrg(app, orgA, async (q) => expect(await count(q, table, where, params)).toBe(1));
    if (isAppendOnly(table)) await expect(withOrg(app, orgA, change)).rejects.toMatchObject(PERMISSION_DENIED);
    else await withOrg(app, orgA, async (q) => expect(await change(q)).toBe(1));
  });

  it("hides the row of organization A from organization B", async () => {
    factoryFor(table);
    const { where, params } = byPk(table, rowsA[table] ?? {});
    await withOrg(app, orgB, async (q) => {
      expect(await count(q, table, where, params)).toBe(0);
      expect(await count(q, table, "organization_id = $1", [orgA])).toBe(0);
      // B enxerga as próprias linhas: o zero acima é isolamento, não tabela inacessível.
      expect(await count(q, table, "true", [])).toBeGreaterThanOrEqual(1);
    });
  });

  it("does not let organization B update the row of organization A", async () => {
    factoryFor(table);
    const row = rowsA[table] ?? {};
    const { where, params } = byPk(table, row);
    // Tentativa de sequestro: trazer a linha de A para B.
    const steal = byPk(table, row, 2);
    const touch = (q: OrgQuery) => q.exec(`update ${ident(table)} set organization_id = organization_id where ${where}`, params);
    const take = (q: OrgQuery) => q.exec(`update ${ident(table)} set organization_id = $1 where ${steal.where}`, [orgB, ...steal.params]);
    for (const attempt of [touch, take]) {
      if (isAppendOnly(table)) await expect(withOrg(app, orgB, attempt)).rejects.toMatchObject(PERMISSION_DENIED);
      else await withOrg(app, orgB, async (q) => expect(await attempt(q)).toBe(0));
    }
    await withOrg(app, orgA, async (q) => expect(await count(q, table, where, params)).toBe(1));
  });

  it("does not let organization B move its own row into organization A", async () => {
    const row = rowsB[table] ?? {};
    const { where, params } = byPk(table, row, 2);
    await expect(
      withOrg(app, orgB, (q) => q.exec(`update ${ident(table)} set organization_id = $1 where ${where}`, [orgA, ...params])),
    ).rejects.toMatchObject(isAppendOnly(table) ? PERMISSION_DENIED : { code: RLS_VIOLATION });
  });

  it("does not let organization B delete the row of organization A", async () => {
    factoryFor(table);
    const { where, params } = byPk(table, rowsA[table] ?? {});
    const byKey = (q: OrgQuery) => q.exec(`delete from ${ident(table)} where ${where}`, params);
    const byOrg = (q: OrgQuery) => q.exec(`delete from ${ident(table)} where organization_id = $1`, [orgA]);
    for (const attempt of [byKey, byOrg]) {
      if (isAppendOnly(table)) await expect(withOrg(app, orgB, attempt)).rejects.toMatchObject(PERMISSION_DENIED);
      else await withOrg(app, orgB, async (q) => expect(await attempt(q)).toBe(0));
    }
    await withOrg(app, orgA, async (q) => expect(await count(q, table, where, params)).toBe(1));
  });

  it("refuses an insert for organization A made inside organization B", async () => {
    const row = factoryFor(table)(orgA, rowsA);
    await expect(withOrg(app, orgB, (q) => insert(q, table, row))).rejects.toMatchObject({ code: RLS_VIOLATION });
  });
});

describe("isolation of organizations", () => {
  it("shows an organization only itself", async () => {
    await withOrg(app, orgB, async (q) => {
      expect(await q.many<{ id: string }>("select id from organizations")).toEqual([{ id: orgB }]);
      expect(await q.exec("update organizations set name = 'taken' where id = $1", [orgA])).toBe(0);
      expect(await q.exec("delete from organizations where id = $1", [orgA])).toBe(0);
    });
    await expect(
      withOrg(app, orgB, (q) => q.exec("insert into organizations (id, name) values ($1, 'intruder')", [randomUUID()])),
    ).rejects.toMatchObject({ code: RLS_VIOLATION });
    await withOrg(app, orgA, async (q) => expect(await q.one("select name from organizations")).toEqual({ name: "isolation A" }));
  });
});

describe("phone numbers", () => {
  it("cannot be attached to a trunk of another organization", async () => {
    await expect(
      withOrg(app, orgB, (q) =>
        q.exec("insert into phone_numbers (organization_id, trunk_id, e164) values ($1, $2, '+5531900000001')", [orgB, rowsA.trunks?.id]),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      withOrg(app, orgB, (q) => q.exec("update phone_numbers set trunk_id = $1 where id = $2", [rowsA.trunks?.id, rowsB.phone_numbers?.id])),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("always has a trunk", async () => {
    await expect(
      withOrg(app, orgB, (q) => q.exec("insert into phone_numbers (organization_id, e164) values ($1, '+5531900000002')", [orgB])),
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("cannot be reserved by another organization: the same number may exist in both", async () => {
    const taken = String(rowsA.phone_numbers?.e164);
    await withOrg(app, orgB, async (q) => {
      expect(await q.exec("insert into phone_numbers (organization_id, trunk_id, e164) values ($1, $2, $3)", [orgB, rowsB.trunks?.id, taken])).toBe(1);
      expect(await count(q, "phone_numbers", "e164 = $1", [taken])).toBe(1);
    });
    await expect(
      withOrg(app, orgB, (q) => q.exec("insert into phone_numbers (organization_id, trunk_id, e164) values ($1, $2, $3)", [orgB, rowsB.trunks?.id, taken])),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("withOrg and withSystem", () => {
  it("reads nothing outside a scoped transaction, even on a reused connection", async () => {
    await withOrg(app, orgA, (q) => q.many("select 1"));
    for (const { name } of [...scoped, { name: "organizations" }]) {
      const result = await app.pool.query<{ n: number }>(`select count(*)::int as n from ${ident(name)}`);
      expect(result.rows[0]?.n, name).toBe(0);
    }
  });

  it("withSystem sees every organization", async () => {
    const seen = await withSystem(app, (q) => q.many<{ id: string }>("select id from organizations where id = any ($1)", [[orgA, orgB]]));
    expect(seen.map((row) => row.id).sort()).toEqual([orgA, orgB].sort());
  });

  it("gives no access to organization A when organization B turns on app.system", async () => {
    await withOrg(app, orgB, async (q) => {
      await q.many("select set_config('app.system', 'on', true)");
      for (const { name } of scoped) {
        expect(await count(q, name, "organization_id = $1", [orgA]), name).toBe(0);
        // Tabela só de acréscimo recusa qualquer delete pela permissão; a recusa é provada acima.
        if (!isAppendOnly(name)) expect(await q.exec(`delete from ${ident(name)} where organization_id = $1`, [orgA]), name).toBe(0);
      }
      expect(await count(q, "organizations", "id = $1", [orgA])).toBe(0);
    });
    await withOrg(app, orgA, async (q) => {
      for (const { name } of scoped) expect(await count(q, name, "true", []), name).toBeGreaterThanOrEqual(1);
    });
  });

  it("does not let the application role become the system role", async () => {
    await expect(withOrg(app, orgB, (q) => q.exec("set local role deskvoice_system"))).rejects.toMatchObject({ code: "42501" });
    await expect(withOrg(app, orgB, (q) => q.exec("set local session authorization deskvoice_system"))).rejects.toMatchObject({ code: "42501" });
    // Desligar row_security não abre nada: para quem não tem BYPASSRLS a consulta passa a ser recusada.
    await expect(
      withOrg(app, orgB, async (q) => {
        await q.exec("set local row_security = off");
        return count(q, "users", "organization_id = $1", [orgA]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses withSystem on a Db created without the system connection", async () => {
    const appOnly = createDb(process.env.TEST_DATABASE_URL ?? "");
    try {
      await expect(withSystem(appOnly, (q) => q.many("select 1"))).rejects.toThrow(/no system pool/);
    } finally {
      await appOnly.close();
    }
  });

  it("rolls back when the callback throws and commits when it returns", async () => {
    const key = unique("rollback");
    await expect(
      withOrg(app, orgA, async (q) => {
        await q.exec("insert into settings (organization_id, key, value) values ($1, $2, '1')", [orgA, key]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await withOrg(app, orgA, async (q) => {
      expect(await count(q, "settings", "key = $1", [key])).toBe(0);
      await q.exec("insert into settings (organization_id, key, value) values ($1, $2, '1')", [orgA, key]);
    });
    await withOrg(app, orgA, async (q) => expect(await count(q, "settings", "key = $1", [key])).toBe(1));
  });

  it("exposes the organization id and refuses one that is not a uuid", async () => {
    expect(await withOrg(app, orgA, async (q) => q.organizationId)).toBe(orgA);
    await expect(withOrg(app, "not-a-uuid", async () => 1)).rejects.toThrow(/organization id/);
  });

  it("does not let a row point at a row of another organization", async () => {
    // Chave estrangeira ignora RLS; quem barra é a chave composta (organization_id, id).
    await expect(
      withOrg(app, orgB, (q) =>
        q.exec("insert into call_events (organization_id, call_id, at, kind) values ($1, $2, $3, 'call_started')", [orgB, rowsA.calls?.id, at]),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
