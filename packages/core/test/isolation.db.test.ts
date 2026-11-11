import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrgQuery } from "../src/types";
import { createDb } from "../src/db";
import { withOrg, withSystem } from "../src/with-org";
import { createOrganization, openTestDbs } from "./helpers";

type Row = Record<string, unknown>;
/** Monta uma linha válida da tabela para a organização, apontando para linhas já criadas dela. */
type Factory = (organizationId: string, parents: Record<string, Row>) => Row;

const at = new Date("2026-01-15T12:00:00Z");
const unique = (prefix: string): string => `${prefix}-${randomUUID()}`;

// Uma fábrica por tabela com `organization_id`, em ordem de dependência. Tabela nova sem fábrica
// reprova este arquivo: é assim que ela é obrigada a entrar no teste de isolamento.
const factories: Record<string, Factory> = {
  users: (organization_id) => ({ organization_id, email: `${unique("user")}@example.com`, name: "User", password_hash: "x", role: "owner" }),
  sessions: (organization_id, p) => ({ organization_id, user_id: p.users?.id, token_hash: unique("token"), expires_at: at }),
  settings: (organization_id) => ({ organization_id, key: unique("key"), value: { on: true } }),
  trunks: (organization_id) => ({ organization_id, name: "Trunk", host: "sip.example.com", auth_mode: "register" }),
  agents: (organization_id) => ({ organization_id, name: "Agent", engine: "simulated" }),
  phone_numbers: (organization_id, p) => ({ organization_id, trunk_id: p.trunks?.id, e164: `+55${Math.floor(1e10 + Math.random() * 9e10)}`, agent_id: p.agents?.id }),
  calls: (organization_id, p) => ({ organization_id, agent_id: p.agents?.id, direction: "inbound", status: "ringing", started_at: at }),
  call_events: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, at, kind: "call_started", payload: {} }),
  approvals: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, question: "Pode?", default_on_timeout: "denied", expires_at: at }),
  tasks: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, kind: "isolation_probe", payload: {}, status: "done" }),
  notifications: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, channel: "panel", body: "Aviso" }),
  outbound_policy: (organization_id) => ({ organization_id }),
  do_not_call: (organization_id) => ({ organization_id, e164: `+55${Math.floor(1e10 + Math.random() * 9e10)}` }),
  usage_ledger: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, engine: "simulated", at }),
};

const UNSCOPED_TABLES = ["organizations", "schema_migrations"];
const RLS_VIOLATION = "42501";

const { app, owner } = openTestDbs();

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
const scoped = tables.filter((t) => t.has_org);
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

  it("has organization_id on every table except organizations and schema_migrations", () => {
    expect(tables.filter((t) => !t.has_org).map((t) => t.name).sort()).toEqual([...UNSCOPED_TABLES].sort());
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

  it("has a factory for every table with organization_id, and no stale factory", () => {
    expect(scoped.map((t) => t.name).filter((name) => !(name in factories))).toEqual([]);
    expect(Object.keys(factories).filter((name) => !scoped.some((t) => t.name === name))).toEqual([]);
  });
});

describe.each(scoped.map((t) => t.name))("isolation of %s", (table) => {
  it("lets the owning organization read and change its own row", async () => {
    factoryFor(table);
    const { where, params } = byPk(table, rowsA[table] ?? {});
    await withOrg(app, orgA, async (q) => {
      expect(await count(q, table, where, params)).toBe(1);
      expect(await q.exec(`update ${ident(table)} set organization_id = organization_id where ${where}`, params)).toBe(1);
    });
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
    await withOrg(app, orgB, async (q) => {
      expect(await q.exec(`update ${ident(table)} set organization_id = organization_id where ${where}`, params)).toBe(0);
    });
    // Tentativa de sequestro: trazer a linha de A para B.
    const steal = byPk(table, row, 2);
    await withOrg(app, orgB, async (q) => {
      expect(await q.exec(`update ${ident(table)} set organization_id = $1 where ${steal.where}`, [orgB, ...steal.params])).toBe(0);
    });
    await withOrg(app, orgA, async (q) => expect(await count(q, table, where, params)).toBe(1));
  });

  it("does not let organization B move its own row into organization A", async () => {
    const row = rowsB[table] ?? {};
    const { where, params } = byPk(table, row, 2);
    await expect(
      withOrg(app, orgB, (q) => q.exec(`update ${ident(table)} set organization_id = $1 where ${where}`, [orgA, ...params])),
    ).rejects.toMatchObject({ code: RLS_VIOLATION });
  });

  it("does not let organization B delete the row of organization A", async () => {
    factoryFor(table);
    const { where, params } = byPk(table, rowsA[table] ?? {});
    await withOrg(app, orgB, async (q) => {
      expect(await q.exec(`delete from ${ident(table)} where ${where}`, params)).toBe(0);
      expect(await q.exec(`delete from ${ident(table)} where organization_id = $1`, [orgA])).toBe(0);
    });
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
        expect(await q.exec(`delete from ${ident(name)} where organization_id = $1`, [orgA]), name).toBe(0);
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
