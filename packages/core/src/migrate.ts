import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./types";

const MIGRATION_NAME = /^\d{8}T\d{6}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
// Chave arbitrária e fixa da trava: dois processos subindo juntos não aplicam a mesma migration.
const LOCK_KEY = 4_771_001;

/**
 * Aplica as migrations de `dir` em ordem de nome, uma transação por arquivo, e devolve as que
 * aplicou agora. `db` precisa ser a conexão do dono do schema (`migrationDatabaseUrl`).
 * Arquivo já aplicado cujo conteúdo mudou é erro: migration publicada não se edita.
 */
export async function runMigrations(db: Db, dir: string): Promise<string[]> {
  const names = (await readdir(dir)).sort();
  for (const name of names) {
    if (!MIGRATION_NAME.test(name)) {
      throw new Error(`Invalid migration file name ${JSON.stringify(name)} in ${dir}: expected AAAAMMDDTHHMMSS_slug.sql`);
    }
  }
  const files = await Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(dir, name), "utf8");
      return { name, sql, sha256: createHash("sha256").update(sql).digest("hex") };
    }),
  );

  const client = await db.pool.connect();
  let failure: unknown;
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      "create table if not exists schema_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())",
    );
    const ledger = await client.query<{ name: string; sha256: string }>("select name, sha256 from schema_migrations");
    const applied = new Map(ledger.rows.map((row) => [row.name, row.sha256]));

    for (const file of files) {
      const recorded = applied.get(file.name);
      if (recorded !== undefined && recorded !== file.sha256) {
        throw new Error(`Migration ${file.name} changed after it was applied (sha256 ${recorded} recorded, ${file.sha256} on disk). Write a new migration instead of editing it.`);
      }
    }

    const appliedNow: string[] = [];
    for (const file of files) {
      if (applied.has(file.name)) continue;
      await client.query("begin");
      try {
        await client.query(file.sql);
        await client.query("insert into schema_migrations (name, sha256) values ($1, $2)", [file.name, file.sha256]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      appliedNow.push(file.name);
    }
    return appliedNow;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // Depois de erro a conexão é destruída, o que também solta a trava; devolvê-la ao pool com a
    // trava presa travaria o próximo executor.
    if (failure === undefined) await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    client.release(failure !== undefined);
  }
}
