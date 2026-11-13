import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../test/helpers";
import { createDb } from "./db";
import { runMigrations } from "./migrate";
import type { Db } from "./types";

const REAL_MIGRATIONS = path.resolve(import.meta.dirname, "../../../db/migrations");

// Cada teste roda num banco próprio, criado na hora: o executor mexe em `schema_migrations` e em
// tabelas de exemplo, e isso não pode vazar para o schema que os outros arquivos usam.
const { app, owner } = openTestDbs();
let db: Db;
let dbName: string;
let dir: string;

beforeAll(() => app.close());
afterAll(() => owner.close());

beforeEach(async () => {
  dbName = `migrate_${randomUUID().replaceAll("-", "")}`;
  await owner.pool.query(`create database ${dbName}`);
  const url = new URL(process.env.TEST_MIGRATION_DATABASE_URL ?? "");
  url.pathname = `/${dbName}`;
  db = createDb(url.toString());
  dir = await mkdtemp(path.join(tmpdir(), "deskvoice-migrations-"));
});

afterEach(async () => {
  await db.close();
  await owner.pool.query(`drop database ${dbName} with (force)`);
  await rm(dir, { recursive: true });
});

const write = (name: string, sql: string): Promise<void> => writeFile(path.join(dir, name), sql);
const applied = async (): Promise<string[]> =>
  (await db.pool.query<{ name: string }>("select name from schema_migrations order by name")).rows.map((row) => row.name);

describe("runMigrations", () => {
  it("applies in name order and is a no-op the second time", async () => {
    await write("20260102T000000_second.sql", "insert into first_table values (2);");
    await write("20260101T000000_first.sql", "create table first_table (n int); insert into first_table values (1);");

    expect(await runMigrations(db, dir)).toEqual(["20260101T000000_first.sql", "20260102T000000_second.sql"]);
    expect(await runMigrations(db, dir)).toEqual([]);

    expect((await db.pool.query("select n from first_table order by n")).rows).toEqual([{ n: 1 }, { n: 2 }]);
    const ledger = await db.pool.query<{ name: string; sha256: string; applied_at: Date }>("select * from schema_migrations order by name");
    expect(ledger.rows.map((row) => row.name)).toEqual(["20260101T000000_first.sql", "20260102T000000_second.sql"]);
    expect(ledger.rows[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.rows[0]?.applied_at).toBeInstanceOf(Date);
  });

  it("applies only what is new", async () => {
    await write("20260101T000000_first.sql", "create table a (n int);");
    await runMigrations(db, dir);
    await write("20260103T000000_third.sql", "create table c (n int);");
    expect(await runMigrations(db, dir)).toEqual(["20260103T000000_third.sql"]);
  });

  it("refuses a file that changed after it was applied, naming it", async () => {
    await write("20260101T000000_first.sql", "create table a (n int);");
    await runMigrations(db, dir);
    await write("20260101T000000_first.sql", "create table a (n int, extra text);");
    await write("20260102T000000_second.sql", "create table b (n int);");

    await expect(runMigrations(db, dir)).rejects.toThrow(/20260101T000000_first\.sql.*changed after/);
    expect(await applied()).toEqual(["20260101T000000_first.sql"]);
  });

  it.each(["0001_initial.sql", "20260101_first.sql", "20260101T000000-first.sql", "20260101T000000_First.sql", "20260101T000000_first.sql.bak", "notes.md"])(
    "refuses the file name %s before applying anything",
    async (name) => {
      await write("20250101T000000_valid.sql", "create table a (n int);");
      await write(name, "select 1;");
      await expect(runMigrations(db, dir)).rejects.toThrow(new RegExp(`${name.replaceAll(".", "\\.")}.*AAAAMMDDTHHMMSS_slug\\.sql`));
      expect((await db.pool.query("select to_regclass('a') as a, to_regclass('schema_migrations') as ledger")).rows).toEqual([{ a: null, ledger: null }]);
    },
  );

  it("rolls back a failing file whole and keeps the ones before it", async () => {
    await write("20260101T000000_first.sql", "create table a (n int);");
    await write("20260102T000000_broken.sql", "create table b (n int); select * from table_that_does_not_exist;");

    await expect(runMigrations(db, dir)).rejects.toThrow(/20260102T000000_broken\.sql/);
    expect(await applied()).toEqual(["20260101T000000_first.sql"]);
    expect((await db.pool.query("select to_regclass('b') as b")).rows).toEqual([{ b: null }]);
  });

  it("applies once when two processes start together", async () => {
    await write("20260101T000000_first.sql", "create table a (n int);");
    const results = await Promise.all([runMigrations(db, dir), runMigrations(db, dir)]);
    expect(results.flat()).toEqual(["20260101T000000_first.sql"]);
  });

  it("installs the real schema on an empty database, and again without changing anything", async () => {
    const first = await runMigrations(db, REAL_MIGRATIONS);
    expect(first).toContain("20261110T230000_foundation.sql");
    expect(await runMigrations(db, REAL_MIGRATIONS)).toEqual([]);
    expect(await applied()).toEqual(first);
  });

  it("o número conectado gravado sem o nono dígito ganha o dígito, e o resto fica como estava", async () => {
    const NINTH = "20261113T190000_whatsapp_nono_digito_gravado.sql";
    for (const name of await readdir(REAL_MIGRATIONS)) if (name !== NINTH) await copyFile(path.join(REAL_MIGRATIONS, name), path.join(dir, name));
    await runMigrations(db, dir);
    // Uma sessão de cada tipo por organização: três organizações para os três casos.
    const orgs = (await db.pool.query<{ id: string }>("insert into organizations (name) values ('A'), ('B'), ('C') returning id")).rows.map((row) => row.id);
    await db.pool.query("insert into whatsapp_sessions (organization_id, session_name, phone_e164) values ($1, 'qr', '+553188887777')", [orgs[0]]);
    await db.pool.query(
      "insert into whatsapp_call_sessions (organization_id, session_name, phone_e164) values ($1, 'calls-old', '+551176543210'), ($2, 'calls-fixed', '+553132221111'), ($3, 'calls-new', '+5531988887777')",
      orgs,
    );
    await copyFile(path.join(REAL_MIGRATIONS, NINTH), path.join(dir, NINTH));
    expect(await runMigrations(db, dir)).toEqual([NINTH]);
    const phones = async (table: string) => (await db.pool.query<{ session_name: string; phone_e164: string }>(`select session_name, phone_e164 from ${table} order by session_name`)).rows;
    expect(await phones("whatsapp_sessions")).toEqual([{ session_name: "qr", phone_e164: "+5531988887777" }]);
    expect(await phones("whatsapp_call_sessions")).toEqual([
      { session_name: "calls-fixed", phone_e164: "+553132221111" },
      { session_name: "calls-new", phone_e164: "+5531988887777" },
      { session_name: "calls-old", phone_e164: "+5511976543210" },
    ]);
  });
});
