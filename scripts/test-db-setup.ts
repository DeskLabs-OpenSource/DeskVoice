// globalSetup do projeto Vitest `db`: garante um Postgres com o schema aplicado e entrega aos
// testes três conexões:
//   TEST_DATABASE_URL            papel de aplicação (`deskvoice_app`), sujeito a RLS
//   TEST_SYSTEM_DATABASE_URL     papel de sistema (`deskvoice_system`), atravessa organizações
//   TEST_MIGRATION_DATABASE_URL  dono do schema
//
// - Nada definido: sobe um contêiner descartável e o derruba no fim.
// - Só TEST_DATABASE_URL: é a URL do dono de um Postgres já no ar (a que `pnpm db:test:up`
//   imprime); os dois papéis ganham senha de teste e as três URLs são derivadas dela.
// - As três definidas: são usadas como estão.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createDb } from "../packages/core/src/db";
import { runMigrations } from "../packages/core/src/migrate";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts/test-db.sh");
const TEST_PASSWORD = "deskvoice_test";

export default async function setup(): Promise<() => Promise<void>> {
  const given = process.env.TEST_DATABASE_URL;
  const givenOwner = process.env.TEST_MIGRATION_DATABASE_URL;
  const asGiven = given !== undefined && givenOwner !== undefined;
  if (asGiven && !process.env.TEST_SYSTEM_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are set, so TEST_SYSTEM_DATABASE_URL must be set too");
  }

  // Nome próprio por execução: duas suítes na mesma máquina não derrubam o banco uma da outra.
  const containerEnv = { ...process.env, DESKVOICE_TEST_DB_CONTAINER: `deskvoice-test-db-${process.pid}` };
  const startedContainer = given === undefined;
  const stopContainer = (): void => {
    if (startedContainer) execFileSync("bash", [script, "down"], { env: containerEnv, stdio: "inherit" });
  };

  const ownerUrl = givenOwner ?? given ?? execFileSync("bash", [script, "up"], { env: containerEnv, encoding: "utf8" }).trim();
  const roleUrl = (role: string): string => {
    const url = new URL(ownerUrl);
    url.username = role;
    url.password = TEST_PASSWORD;
    return url.toString();
  };

  try {
    const owner = createDb(ownerUrl);
    try {
      await runMigrations(owner, path.join(root, "db/migrations"));
      if (!asGiven) {
        await owner.pool.query(`alter role deskvoice_app password '${TEST_PASSWORD}'`);
        await owner.pool.query(`alter role deskvoice_system password '${TEST_PASSWORD}'`);
      }
    } finally {
      await owner.close();
    }
  } catch (error) {
    stopContainer();
    throw error;
  }

  process.env.TEST_MIGRATION_DATABASE_URL = ownerUrl;
  if (!asGiven) {
    process.env.TEST_DATABASE_URL = roleUrl("deskvoice_app");
    process.env.TEST_SYSTEM_DATABASE_URL = roleUrl("deskvoice_system");
  }

  return async () => {
    stopContainer();
  };
}
