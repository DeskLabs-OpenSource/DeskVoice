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
    q.exec("insert into calls (id, organization_id, direction, channel, status, started_at) values ($1, $2, 'inbound', 'phone', 'in_progress', $3)", [id, organizationId, startedAt]),
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

/**
 * Grava a lista de destinos de passagem sem o gatilho que confere a organização, como um banco mexido à
 * mão: é como o teste prova que a leitura também confere. Só o dono do schema (`owner`) consegue, e numa
 * transação só, para nenhuma outra conexão ver a tabela sem o gatilho.
 */
export async function forceHandoffTargets(owner: Db, agentId: string, targets: string[]): Promise<void> {
  const client = await owner.pool.connect();
  try {
    await client.query("begin");
    await client.query("alter table agents disable trigger agents_handoff_targets_check");
    await client.query("update agents set agent_handoff_targets = $2 where id = $1", [agentId, targets]);
    await client.query("alter table agents enable trigger agents_handoff_targets_check");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
