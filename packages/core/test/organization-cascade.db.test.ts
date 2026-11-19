// A cascata da exclusão de organização (R8, fatia 9a). Desenho:
// docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, "Fatia 9".
//
// As chaves e as tabelas vêm do catálogo do Postgres, nunca de lista escrita à mão: a tabela que
// nascer depois com chave para `organizations` sem cascata reprova este arquivo, e a que nascer com
// `organization_id` sem fábrica em ./org-rows também.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordInstallationEvent } from "../src/installation";
import { withSystem } from "../src/with-org";
import { createOrganization, openTestDbs } from "./helpers";
import { type Row, ident, insert, organizationFactories, spareAccounts } from "./org-rows";

// As únicas chaves para `organizations (id)` que NÃO apagam em cascata. Ficam `on delete set null`,
// e cada uma tem o motivo escrito. Exceção nova precisa de motivo; exceção que sumiu do catálogo
// reprova (lista velha não passa).
const SET_NULL_EXCEPTIONS: Record<string, string> = {
  "installation_events.organization_id": "o registro da instalação guarda a própria exclusão da organização: a linha fica, sem a organização",
  "accounts.last_organization_id": "a conta é da instalação e não morre com a organização: só manda o próximo login para outro vínculo",
};

// `installation_events` tem `organization_id`, mas é da instalação: não tem fábrica em ./org-rows
// (o teste de isolamento não a escopa) e entra aqui pelo caminho do produto.
const INSTALLATION_EVENTS = "installation_events";

const { app, owner } = openTestDbs();

const keys = (
  await owner.pool.query<{ table: string; columns: string[]; on_delete: string }>(`
    select c.conrelid::regclass::text as table,
           array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, n)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.n) as columns,
           c.confdeltype::text as on_delete
      from pg_constraint c
     where c.contype = 'f' and c.confrelid = 'public.organizations'::regclass
     order by 1, 2`)
).rows;
const keyName = (key: { table: string; columns: string[] }): string => `${key.table}.${key.columns.join(",")}`;

const orgTables = (
  await owner.pool.query<{ name: string }>(`
    select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and exists (select from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped)
     order by c.relname`)
).rows.map((t) => t.name);

afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("foreign keys to organizations (generated from the catalog)", () => {
  it("finds the keys in the catalog", () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it("every key to organizations (id) deletes in cascade, except the named set-null ones", () => {
    const withoutCascade = keys.filter((key) => key.on_delete !== "c" && !Object.hasOwn(SET_NULL_EXCEPTIONS, keyName(key)));
    expect(withoutCascade.map(keyName), "add `on delete cascade`, or name the exception with its reason").toEqual([]);
  });

  it.each(Object.entries(SET_NULL_EXCEPTIONS))("the exception %s still exists and is `on delete set null`", (name) => {
    const found = keys.filter((key) => keyName(key) === name);
    expect(found, `${name} is not a key to organizations anymore: take it off SET_NULL_EXCEPTIONS`).toHaveLength(1);
    expect(found[0]?.on_delete, name).toBe("n");
  });
});

describe("deleting an organization", () => {
  let orgA: string;
  let orgB: string;
  let accountA: string;
  const marker = randomUUID();

  const countByOrg = (table: string, organizationId: string): Promise<number> =>
    withSystem(app, async (q) => (await q.one<{ n: number }>(`select count(*)::int as n from ${ident(table)} where organization_id = $1`, [organizationId]))?.n ?? -1);
  const countsOf = async (organizationId: string): Promise<Record<string, number>> =>
    Object.fromEntries(await Promise.all(orgTables.map(async (table) => [table, await countByOrg(table, organizationId)] as const)));

  beforeAll(async () => {
    const nextAccount = await spareAccounts(app, 2, "organization-cascade.db.test.ts");
    const factories = organizationFactories(nextAccount);
    orgA = await createOrganization(app, "cascade A");
    orgB = await createOrganization(app, "cascade B");
    for (const organizationId of [orgA, orgB]) {
      const rows: Record<string, Row> = {};
      // Uma linha em cada tabela, pelas fábricas do teste de isolamento e na ordem delas. O papel de
      // sistema grava todas, inclusive as que a organização não escreve.
      await withSystem(app, async (q) => {
        for (const [table, factory] of Object.entries(factories)) rows[table] = await insert(q, table, factory(organizationId, rows));
        await recordInstallationEvent(q, new Date("2026-01-15T12:00:00Z"), "organization_limits_changed", { organizationId, payload: { cascade_test: marker } });
        await q.exec("update accounts set last_organization_id = $2 where id = $1", [rows.users?.account_id, organizationId]);
      });
      if (organizationId === orgA) accountA = String(rows.users?.account_id);
    }
  });

  it("has a factory for every table with organization_id", () => {
    const factories = organizationFactories(() => "");
    const missing = orgTables.filter((table) => table !== INSTALLATION_EVENTS && !Object.hasOwn(factories, table));
    expect(missing, "add a factory in packages/core/test/org-rows.ts").toEqual([]);
  });

  it("removes every row of the organization in every table, and leaves the other one as it was", async () => {
    const beforeA = await countsOf(orgA);
    const beforeB = await countsOf(orgB);
    // Cada tabela tem linha das duas antes: senão a contagem de depois não prova nada.
    expect(Object.entries(beforeA).filter(([, n]) => n < 1)).toEqual([]);
    expect(Object.entries(beforeB).filter(([, n]) => n < 1)).toEqual([]);

    const deleted = await withSystem(app, (q) => q.exec("delete from organizations where id = $1", [orgA]));
    expect(deleted).toBe(1);

    expect(await countsOf(orgA)).toEqual(Object.fromEntries(orgTables.map((table) => [table, 0])));
    expect(await countsOf(orgB)).toEqual(beforeB);
    expect(await withSystem(app, (q) => q.one("select id from organizations where id = $1", [orgB]))).not.toBeNull();
  });

  it("keeps the installation events of the deleted organization, without the organization", async () => {
    const events = await withSystem(app, (q) =>
      q.many<{ organization_id: string | null }>("select organization_id from installation_events where payload->>'cascade_test' = $1 order by id", [marker]),
    );
    expect(events.map((e) => e.organization_id)).toEqual([null, orgB]);
  });

  it("keeps the account, and sends its next login elsewhere", async () => {
    const account = await withSystem(app, (q) => q.one<{ last_organization_id: string | null }>("select last_organization_id from accounts where id = $1", [accountA]));
    expect(account).toEqual({ last_organization_id: null });
  });
});
