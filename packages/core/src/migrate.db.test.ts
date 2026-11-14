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

  it("as chamadas que já existem herdam o canal do evento, a simulada vira simulada, o resto fica como linha, e a coluna perde o padrão", async () => {
    const CHANNEL = "20261114T014000_canal_da_chamada.sql";
    for (const name of await readdir(REAL_MIGRATIONS)) if (name < CHANNEL) await copyFile(path.join(REAL_MIGRATIONS, name), path.join(dir, name));
    await runMigrations(db, dir);
    const org = (await db.pool.query<{ id: string }>("insert into organizations (name) values ('A') returning id")).rows[0]?.id;
    const call = async (event: object | null, row: { engine?: string; to?: string } = {}): Promise<string> => {
      const id = (
        await db.pool.query<{ id: string }>("insert into calls (organization_id, direction, status, engine, to_e164, started_at) values ($1, 'inbound', 'completed', $2, $3, now()) returning id", [
          org,
          row.engine ?? null,
          row.to ?? null,
        ])
      ).rows[0]?.id ?? "";
      if (event) await db.pool.query("insert into call_events (organization_id, call_id, at, kind, payload) values ($1, $2, now(), 'call_started', $3)", [org, id, event]);
      return id;
    };
    const whatsapp = await call({ direction: "inbound", channel: "whatsapp" });
    const web = await call({ direction: "inbound", channel: "web", userId: "u" });
    const phone = await call({ direction: "inbound" });
    const silent = await call(null);
    // A simulada do botão não registrava canal: motor simulado e nenhum número chamado.
    const simulated = await call({ direction: "inbound" }, { engine: "simulated" });
    // Ligação da linha com agente de motor simulado: tem o número chamado, continua linha.
    const lineWithSimulatedEngine = await call({ direction: "inbound" }, { engine: "simulated", to: "+553132221100" });
    // Navegador com agente de motor simulado: o evento manda.
    const webWithSimulatedEngine = await call({ direction: "inbound", channel: "web" }, { engine: "simulated" });
    await copyFile(path.join(REAL_MIGRATIONS, CHANNEL), path.join(dir, CHANNEL));
    expect(await runMigrations(db, dir)).toEqual([CHANNEL]);
    const channels = new Map((await db.pool.query<{ id: string; channel: string }>("select id, channel from calls")).rows.map((row) => [row.id, row.channel]));
    expect([whatsapp, web, phone, silent, simulated, lineWithSimulatedEngine, webWithSimulatedEngine].map((id) => channels.get(id))).toEqual([
      "whatsapp",
      "web",
      "phone",
      "phone",
      "simulated",
      "phone",
      "web",
    ]);
    // Sem padrão depois do backfill: quem cria uma chamada diz o canal.
    await expect(db.pool.query("insert into calls (organization_id, direction, status, started_at) values ($1, 'inbound', 'completed', now())", [org])).rejects.toThrow(/channel/);
  });

  it("o agente que já existe ganha a lista de termos vazia, o novo sem a coluna também, e a lista não aceita nulo", async () => {
    const VOCABULARY = "20261114T063000_vocabulario_do_agente.sql";
    for (const name of await readdir(REAL_MIGRATIONS)) if (name < VOCABULARY) await copyFile(path.join(REAL_MIGRATIONS, name), path.join(dir, name));
    await runMigrations(db, dir);
    const org = (await db.pool.query<{ id: string }>("insert into organizations (name) values ('A') returning id")).rows[0]?.id;
    await db.pool.query("insert into agents (organization_id, name, engine) values ($1, 'Antes', 'simulated')", [org]);
    await copyFile(path.join(REAL_MIGRATIONS, VOCABULARY), path.join(dir, VOCABULARY));
    expect(await runMigrations(db, dir)).toEqual([VOCABULARY]);
    await db.pool.query("insert into agents (organization_id, name, engine) values ($1, 'Depois', 'simulated')", [org]);
    const rows = (await db.pool.query<{ name: string; vocabulary: string[] }>("select name, vocabulary from agents order by name")).rows;
    expect(rows).toEqual([
      { name: "Antes", vocabulary: [] },
      { name: "Depois", vocabulary: [] },
    ]);
    await expect(db.pool.query("insert into agents (organization_id, name, engine, vocabulary) values ($1, 'Nulo', 'simulated', null)", [org])).rejects.toThrow(/vocabulary/);
  });

  it("o agente que já existe fica no ambiente normal, o novo sem a coluna também, e o ambiente só aceita normal ou noisy", async () => {
    const ENVIRONMENT = "20261114T120000_agents_listening_environment.sql";
    for (const name of await readdir(REAL_MIGRATIONS)) if (name < ENVIRONMENT) await copyFile(path.join(REAL_MIGRATIONS, name), path.join(dir, name));
    await runMigrations(db, dir);
    const org = (await db.pool.query<{ id: string }>("insert into organizations (name) values ('A') returning id")).rows[0]?.id;
    await db.pool.query("insert into agents (organization_id, name, engine) values ($1, 'Antes', 'simulated')", [org]);
    await copyFile(path.join(REAL_MIGRATIONS, ENVIRONMENT), path.join(dir, ENVIRONMENT));
    expect(await runMigrations(db, dir)).toEqual([ENVIRONMENT]);
    await db.pool.query("insert into agents (organization_id, name, engine) values ($1, 'Depois', 'simulated')", [org]);
    await db.pool.query("insert into agents (organization_id, name, engine, listening_environment) values ($1, 'Obra', 'simulated', 'noisy')", [org]);
    const rows = (await db.pool.query<{ name: string; listening_environment: string }>("select name, listening_environment from agents order by name")).rows;
    expect(rows).toEqual([
      { name: "Antes", listening_environment: "normal" },
      { name: "Depois", listening_environment: "normal" },
      { name: "Obra", listening_environment: "noisy" },
    ]);
    await expect(db.pool.query("insert into agents (organization_id, name, engine, listening_environment) values ($1, 'Alto', 'simulated', 'loud')", [org])).rejects.toThrow(/listening_environment/);
    await expect(db.pool.query("insert into agents (organization_id, name, engine, listening_environment) values ($1, 'Nulo', 'simulated', null)", [org])).rejects.toThrow(/listening_environment/);
  });
});
