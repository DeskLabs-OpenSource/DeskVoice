import { randomUUID } from "node:crypto";
import { withSystem, type ClaimedTask, type Db } from "@deskvoice/core";
import { secretKey } from "../../../packages/tools/test/helpers";
import type { RoutineDeps } from "../src/types";

export { createCall, createOrganization, openTestDbs } from "../../../packages/core/test/helpers";
export { createUser, eventsOf, fakeFetch, fakeLookup, notificationsOf, putSetting, putWhatsAppConnector, secretKey, tasksOf } from "../../../packages/tools/test/helpers";

// As rotinas vivem em 2031: o que enfileiram nunca fica elegível para os testes da fila (2001)
// nem do runner (2003).
export const t0 = new Date("2031-03-01T09:00:00Z");

export const task = (organizationId: string, kind: string, payload: Record<string, unknown> = {}, callId: string | null = null): ClaimedTask => ({
  id: randomUUID(),
  organizationId,
  callId,
  kind,
  payload,
  attempts: 1,
});

export const depsFor = (db: Db, extra: Partial<RoutineDeps> = {}): RoutineDeps => ({ db, clock: { now: () => t0 }, secretKey, ...extra });

export async function createNotification(app: Db, organizationId: string, channel: string, target: string | null, callId: string | null = null): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into notifications (id, organization_id, call_id, channel, target, body, created_at) values ($1, $2, $3, $4, $5, 'Cliente pediu retorno.', $6)", [
      id,
      organizationId,
      callId,
      channel,
      target,
      t0,
    ]),
  );
  return id;
}

/** Espera uma condição que depende do banco, sem dormir tempo fixo. */
export async function until(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
