import { fileURLToPath } from "node:url";
import { createDb, runMigrations, withSystem, type Db } from "@deskvoice/core";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../db/migrations", import.meta.url));

/**
 * Define a senha de um papel do banco. `alter role` não aceita parâmetro, então o comando é
 * montado pelo próprio Postgres com `format`: `%I` escapa o identificador e `%L` o literal.
 */
export async function setRolePassword(owner: Db, role: string, password: string): Promise<void> {
  await withSystem(owner, async (q) => {
    const command = await q.one<{ sql: string }>("select format('alter role %I password %L', $1::text, $2::text) as sql", [role, password]);
    if (!command) throw new Error(`Could not build the command to set the password of ${role}`);
    await q.exec(command.sql);
  });
}

/** Abre a conexão do dono do schema. Os dois pools são o dono: aqui `withSystem` roda como ele. */
export const openOwnerDb = (url: string): Db => createDb(url, url);

async function main(): Promise<void> {
  const out = (text: string): void => void process.stdout.write(`${text}\n`);
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is missing: migrations run with the schema owner's connection");

  const owner = openOwnerDb(url);
  try {
    const applied = await runMigrations(owner, MIGRATIONS_DIR);
    out(applied.length === 0 ? "Nenhuma migration nova: o banco já estava em dia." : `Migrations aplicadas (${applied.length}):\n${applied.map((name) => `  ${name}`).join("\n")}`);

    for (const [role, password] of [
      ["deskvoice_app", process.env.APP_DB_PASSWORD],
      ["deskvoice_system", process.env.SYSTEM_DB_PASSWORD],
    ] as const) {
      if (!password) continue;
      await setRolePassword(owner, role, password);
      out(`Senha do papel ${role} definida.`);
    }
  } finally {
    await owner.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`migrate: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
