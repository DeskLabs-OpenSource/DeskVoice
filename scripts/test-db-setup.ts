// globalSetup do projeto Vitest `db`: garante um Postgres com o schema aplicado e entrega aos
// testes duas conexões: TEST_DATABASE_URL (papel de aplicação, sujeito a RLS) e
// TEST_MIGRATION_DATABASE_URL (dono do schema).
//
// - Nada definido: sobe um contêiner descartável e o derruba no fim.
// - Só TEST_DATABASE_URL: é a URL do dono de um Postgres já no ar (a que `pnpm db:test:up` imprime).
// - As duas definidas: são usadas como estão.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createDb } from "../packages/core/src/db";
import { runMigrations } from "../packages/core/src/migrate";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts/test-db.sh");
const APP_ROLE = "deskvoice_app";
const APP_PASSWORD = "deskvoice_test";

export default async function setup(): Promise<() => Promise<void>> {
  const given = process.env.TEST_DATABASE_URL;
  const givenOwner = process.env.TEST_MIGRATION_DATABASE_URL;
  // Nome próprio por execução: duas suítes na mesma máquina não derrubam o banco uma da outra.
  const containerEnv = { ...process.env, DESKVOICE_TEST_DB_CONTAINER: `deskvoice-test-db-${process.pid}` };
  const startedContainer = given === undefined;
  const stopContainer = (): void => {
    if (startedContainer) execFileSync("bash", [script, "down"], { env: containerEnv, stdio: "inherit" });
  };

  const ownerUrl = givenOwner ?? given ?? execFileSync("bash", [script, "up"], { env: containerEnv, encoding: "utf8" }).trim();

  try {
    const owner = createDb(ownerUrl);
    try {
      await runMigrations(owner, path.join(root, "db/migrations"));
      if (given === undefined || givenOwner === undefined) {
        await owner.pool.query(`alter role ${APP_ROLE} password '${APP_PASSWORD}'`);
      }
    } finally {
      await owner.close();
    }
  } catch (error) {
    stopContainer();
    throw error;
  }

  process.env.TEST_MIGRATION_DATABASE_URL = ownerUrl;
  if (given === undefined || givenOwner === undefined) {
    const appUrl = new URL(ownerUrl);
    appUrl.username = APP_ROLE;
    appUrl.password = APP_PASSWORD;
    process.env.TEST_DATABASE_URL = appUrl.toString();
  }

  return async () => {
    stopContainer();
  };
}
