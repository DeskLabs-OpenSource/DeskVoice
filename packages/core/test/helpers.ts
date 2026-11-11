import { randomUUID } from "node:crypto";
import { createDb } from "../src/db";
import type { Db } from "../src/types";
import { withSystem } from "../src/with-org";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: database tests run through "pnpm test:db" (scripts/test-db-setup.ts)`);
  return value;
}

/**
 * `app` tem os dois pools do produto: aplicação (sujeito a RLS) e sistema (`withSystem`).
 * `owner` é o dono do schema e enxerga tudo.
 */
export function openTestDbs(): { app: Db; owner: Db } {
  return {
    app: createDb(requireEnv("TEST_DATABASE_URL"), requireEnv("TEST_SYSTEM_DATABASE_URL")),
    owner: createDb(requireEnv("TEST_MIGRATION_DATABASE_URL")),
  };
}

/** Cada arquivo de teste trabalha em organizações próprias, para não depender dos dados dos outros. */
export async function createOrganization(app: Db, label: string): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) => q.exec("insert into organizations (id, name) values ($1, $2)", [id, label]));
  return id;
}

export async function createCall(app: Db, organizationId: string, startedAt: Date): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into calls (id, organization_id, direction, status, started_at) values ($1, $2, 'inbound', 'in_progress', $3)", [id, organizationId, startedAt]),
  );
  return id;
}

/** Espera uma condição que depende de notificação do banco, sem dormir tempo fixo. */
export async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
