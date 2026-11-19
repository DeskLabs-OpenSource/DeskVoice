// A rotina que termina a exclusão de organização (R8, fatia 9b), pelo runner de verdade e com o WAHA
// falso por HTTP. As regras da exclusão em si estão em packages/core/test/organization-deletion.db.test.ts;
// aqui fica o que é da rotina: acordar na partida e no pedido, falar com o WAHA pelo nome da sessão e
// esperar 1 minuto, sem girar, quando o WAHA não responde.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAccount, requestOrganizationDeletion, withSystem } from "@deskvoice/core";
import { wahaSessionName } from "@deskvoice/tools";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeWaha } from "../../../packages/tools/test/fake-waha";
import { createOrganization, openTestDbs, secretKey, until } from "../test/helpers";
import { DELETION_RETRY_MS } from "./organization-deletions";
import { startRunner, type Runner, type Schedule } from "./runner";

const { app, owner } = openTestDbs();
const waha = await startFakeWaha();

// Como em runner.db.test.ts: a fila é uma só, e este arquivo vive em 2005.
const t0 = new Date("2005-01-01T00:00:00Z");
let now = t0;
const clock = { now: () => now };

interface FakeTimer {
  fn: () => void;
  delayMs: number;
  cancelled: boolean;
}
let timers: FakeTimer[] = [];
const schedule: Schedule = (fn, delayMs) => {
  const timer: FakeTimer = { fn, delayMs, cancelled: false };
  timers.push(timer);
  return () => {
    timer.cancelled = true;
  };
};
const liveTimer = (): FakeTimer | undefined => timers.find((timer) => !timer.cancelled);
function fire(timer: FakeTimer): void {
  now = new Date(now.getTime() + timer.delayMs);
  timer.cancelled = true;
  timer.fn();
}

let recordings: string;
let actor: string;
let runners: Runner[] = [];
const start = async (): Promise<Runner> => {
  const runner = await startRunner({ db: app, clock, secretKey, schedule, recordingsDir: recordings, waha: waha.options, routines: new Map([["routine_deletion_wake", { kind: "routine_deletion_wake", run: async () => undefined }]]) });
  runners.push(runner);
  return runner;
};

const exists = (target: string): Promise<boolean> =>
  stat(target).then(
    () => true,
    () => false,
  );
const sql = <T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> => withSystem(app, (q) => q.many<T>(text, params));
const orgExists = async (id: string): Promise<boolean> => (await sql("select 1 from organizations where id = $1", [id])).length === 1;
const logouts = (organizationId: string): number => waha.requests.filter((request) => request.method === "POST" && request.path === `/api/sessions/${wahaSessionName(organizationId)}/logout`).length;

/** Uma organização suspensa, com gravação e com a sessão do WhatsApp conectada no WAHA falso. */
async function suspendedOrg(label: string): Promise<{ id: string; name: string }> {
  const id = await createOrganization(app, `${label} ${randomUUID().slice(0, 8)}`);
  const name = (await sql<{ name: string }>("update organizations set suspended_at = $2, suspended_reason = 'teste da rotina de exclusão' where id = $1 returning name", [id, t0]))[0]?.name ?? "";
  await mkdir(path.join(recordings, id), { recursive: true });
  await writeFile(path.join(recordings, id, "call.wav"), "RIFF");
  waha.connect(wahaSessionName(id), "5531999998888");
  return { id, name };
}
const askToDelete = async (org: { id: string; name: string }): Promise<void> => {
  const result = await requestOrganizationDeletion(app, { organizationId: org.id, typedName: org.name, reason: "Contrato encerrado em novembro", accountId: actor, now });
  expect(result).toEqual({ ok: true });
};

beforeAll(async () => {
  recordings = await mkdtemp(path.join(tmpdir(), "deskvoice-routine-deletion-"));
  const id = await withSystem(app, (q) => createAccount(q, { email: `admin-${randomUUID()}@example.test`, passwordHash: "x" }));
  if (!id) throw new Error("account not created");
  actor = id;
  // Outra organização ativa, para a exclusão nunca ser recusada como a última.
  await createOrganization(app, "routine-deletion-keeps");
});
beforeEach(async () => {
  now = t0;
  timers = [];
  waha.sessions.clear();
  waha.requests.length = 0;
  waha.override("POST /api/sessions/x/logout", undefined);
  await sql("delete from tasks where run_at < '2006-01-01' returning id");
});
afterEach(async () => {
  await Promise.all(runners.map((runner) => runner.close()));
  runners = [];
});
afterAll(async () => {
  await rm(recordings, { recursive: true, force: true });
  await waha.stop();
  await app.close();
  await owner.close();
});

describe("the organization deletion routine", () => {
  it("finishes a tombstone left from before, when the runner starts: the WhatsApp session is logged out and the recordings go", async () => {
    const org = await suspendedOrg("rotina partida");
    await askToDelete(org);
    await start();
    await until(async () => !(await orgExists(org.id)), "the organization to be deleted");
    expect(waha.requests.filter((request) => request.path.includes(wahaSessionName(org.id))).map((request) => `${request.method} ${request.path}`)).toEqual([
      `POST /api/sessions/${wahaSessionName(org.id)}/logout`,
      `POST /api/sessions/${wahaSessionName(org.id)}/stop`,
      `DELETE /api/sessions/${wahaSessionName(org.id)}`,
    ]);
    expect(waha.sessions.has(wahaSessionName(org.id))).toBe(false);
    expect(await exists(path.join(recordings, org.id))).toBe(false);
  });

  it("wakes up on the request itself, with nothing in the queue", async () => {
    await start();
    // A primeira volta (a da partida) termina antes do pedido. O timer falso nunca dispara sozinho:
    // o que acorda o runner daqui em diante é só a notificação do pedido.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const org = await suspendedOrg("rotina pedido");
    await askToDelete(org);
    await until(async () => !(await orgExists(org.id)), "the organization to be deleted after the request");
    expect(logouts(org.id)).toBe(1);
  });

  it("with WAHA refusing, waits one minute without spinning, even when the queue wakes it before; then finishes", async () => {
    const org = await suspendedOrg("rotina WAHA fora");
    const logoutRoute = `POST /api/sessions/${wahaSessionName(org.id)}/logout`;
    waha.override(logoutRoute, { status: 500, body: { message: "boom" } });
    await askToDelete(org);
    await start();
    await until(() => liveTimer()?.delayMs === DELETION_RETRY_MS, "a timer armed one minute ahead");
    expect(logouts(org.id)).toBe(1);
    expect(timers.some((timer) => timer.delayMs < DELETION_RETRY_MS)).toBe(false);
    expect(await orgExists(org.id)).toBe(true);
    expect(await exists(path.join(recordings, org.id))).toBe(true);

    // Uma tarefa acorda o runner antes do minuto: a exclusão não é tentada de novo.
    const keeps = (await sql<{ id: string }>("select id from organizations where deleting_at is null and suspended_at is null limit 1"))[0]?.id;
    now = new Date(t0.getTime() + 10_000);
    await sql("insert into tasks (organization_id, kind, payload, run_at, status) values ($1, 'routine_deletion_wake', '{}', $2, 'queued') returning id", [keeps, now]);
    await until(async () => (await sql("select 1 from tasks where kind = 'routine_deletion_wake' and status = 'done'")).length === 1, "the waking task to be done");
    await until(() => liveTimer()?.delayMs === DELETION_RETRY_MS - 10_000, "the timer armed for what is left of the minute");
    expect(logouts(org.id)).toBe(1);

    // Passado o minuto, tenta de novo; o WAHA voltou, e a exclusão termina.
    waha.override(logoutRoute, undefined);
    fire(liveTimer() as FakeTimer);
    await until(async () => !(await orgExists(org.id)), "the organization to be deleted once WAHA is back");
    expect(logouts(org.id)).toBe(2);
  });
});
