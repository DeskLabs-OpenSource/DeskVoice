import { withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { PUT as putCallerMemory } from "./privacy/caller-memory/route";
import { GET as privacy } from "./privacy/route";
import { PUT as putSetting } from "./settings/[key]/route";

/**
 * A chave da memória do número no agente (registro 0020, item 4, revisto na #272): desligada de
 * fábrica, só dono ou administrador a muda, e cada mudança grava `caller_memory_changed` com
 * `{ from, to }`, sem texto livre.
 */
const panel = startPanel();
afterAll(() => panel.close());

const setMemory = (cookie: string, enabled: unknown) => call(putCallerMemory, { method: "PUT", cookie, body: { enabled } });
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];
const read = <T>(org: string, sql: string) => withOrg(panel.app, org, (q) => q.many<T & Record<string, unknown>>(sql));
const orgEvents = (org: string) => read<{ kind: string; actor_user_id: string | null; payload: Record<string, unknown> }>(org, "select kind, actor_user_id, payload from organization_events order by id");

describe("a memória do número no agente", () => {
  it("vem desligada, só aceita booleano, e cada mudança fica registrada com quem mudou", async () => {
    const org = await createOrganization(panel.app, "caller memory key");
    const owner = await createUser(panel.app, org, "owner");
    const admin = await createUser(panel.app, org, "admin");
    expect((await call(privacy, { cookie: owner.cookie })).data).toMatchObject({ callerMemoryAgent: false });

    for (const enabled of ["true", 1, null, undefined]) expect(refusal(await setMemory(owner.cookie, enabled))).toEqual([400, "validation_error"]);
    expect(refusal(await call(putCallerMemory, { method: "PUT", cookie: owner.cookie, body: { enabled: true, note: "x" } }))).toEqual([400, "validation_error"]);
    // Desligar o que já está desligado não é mudança.
    expect((await setMemory(owner.cookie, false)).data).toEqual({ enabled: false });
    expect(await orgEvents(org)).toEqual([]);

    expect((await setMemory(admin.cookie, true)).data).toEqual({ enabled: true });
    expect(await read(org, "select value from settings where key = 'caller_memory.agent'")).toEqual([{ value: true }]);
    expect((await call(privacy, { cookie: owner.cookie })).data).toMatchObject({ callerMemoryAgent: true });
    await setMemory(owner.cookie, true);
    expect((await setMemory(owner.cookie, false)).data).toEqual({ enabled: false });
    expect(await read(org, "select value from settings where key = 'caller_memory.agent'")).toEqual([]);

    expect(await orgEvents(org)).toEqual([
      { kind: "caller_memory_changed", actor_user_id: admin.id, payload: { from: false, to: true } },
      { kind: "caller_memory_changed", actor_user_id: owner.id, payload: { from: true, to: false } },
    ]);
    const shown = (await call(privacy, { cookie: owner.cookie })).data as { history: Array<{ kind: string; actorName: string | null }> };
    expect(shown.history.map((entry) => [entry.kind, entry.actorName])).toEqual([
      ["caller_memory_changed", "Test owner"],
      ["caller_memory_changed", "Test admin"],
    ]);
  });

  it("um operador recebe 403 e nada muda", async () => {
    const org = await createOrganization(panel.app, "caller memory operator");
    const operator = await createUser(panel.app, org, "operator");
    expect(refusal(await setMemory(operator.cookie, true))).toEqual([403, "forbidden"]);
    expect(await read(org, "select key from settings where key = 'caller_memory.agent'")).toEqual([]);
    expect(await orgEvents(org)).toEqual([]);
  });

  it("a rota genérica de configurações não a alcança, porque pularia o registro", async () => {
    const org = await createOrganization(panel.app, "caller memory settings route");
    const owner = await createUser(panel.app, org, "owner");
    const result = await call(putSetting, { method: "PUT", cookie: owner.cookie, params: { key: "caller_memory.agent" }, body: { value: true } });
    expect(refusal(result)).toEqual([400, "unknown_setting"]);
    expect(await read(org, "select key from settings where key = 'caller_memory.agent'")).toEqual([]);
  });

  it("a mudança de uma organização não liga a da outra", async () => {
    const a = await createOrganization(panel.app, "caller memory org a");
    const b = await createOrganization(panel.app, "caller memory org b");
    const ownerA = await createUser(panel.app, a, "owner");
    const ownerB = await createUser(panel.app, b, "owner");
    await setMemory(ownerA.cookie, true);
    expect((await call(privacy, { cookie: ownerB.cookie })).data).toMatchObject({ callerMemoryAgent: false });
    expect(await orgEvents(b)).toEqual([]);
  });
});
