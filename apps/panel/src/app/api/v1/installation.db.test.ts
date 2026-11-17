import { FOUNDING_ORGANIZATION_KEY, addMembership, enqueueTask, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearInstallationState as clear, openTestDbs } from "../../../../../../packages/core/test/helpers";
import { NOW, call, createOrganization, createUser, openSession, startPanel } from "../../../../test/kit";
import { GET as me } from "./auth/me/route";
import { GET as myOrganizations } from "./auth/organizations/route";
import { POST as switchOrganization } from "./auth/switch/route";
import { GET as team } from "./team/route";
import { DELETE as revokeAdmin } from "./installation/admins/[id]/route";
import { GET as listAdmins, POST as grantAdmin } from "./installation/admins/route";
import { GET as listEvents } from "./installation/events/route";
import { POST as inviteOwner } from "./installation/organizations/[id]/invite/route";
import { PATCH as renameOrganization } from "./installation/organizations/[id]/route";
import { DELETE as reactivate, GET as suspensionPreview, POST as suspend } from "./installation/organizations/[id]/suspension/route";
import { GET as listOrganizations, POST as createOrganizationRoute } from "./installation/organizations/route";

const panel = startPanel();
const { owner } = openTestDbs();

// Quem administra a instalação é estado GLOBAL, e os arquivos de banco rodam em série: cada teste
// começa sem fundadora, sem lista explícita e sem marca, e o arquivo devolve o banco assim.
const clearInstallationState = (): Promise<void> => clear(owner);
beforeEach(async () => {
  panel.clock.at = NOW;
  await clearInstallationState();
});
afterAll(async () => {
  await clearInstallationState();
  await owner.close();
  await panel.close();
});

type Person = Awaited<ReturnType<typeof createUser>>;
/** Uma instalação de um cliente só: a fundadora, com dono, administrador e operador. */
async function singleClient(): Promise<{ founding: string; ownerOne: Person; adminOne: Person; operator: Person }> {
  const founding = await createOrganization(panel.app, "Fundadora");
  await withSystem(panel.app, (q) => q.exec("insert into installation_settings (key, value) values ($1, to_jsonb($2::text))", [FOUNDING_ORGANIZATION_KEY, founding]));
  return { founding, ownerOne: await createUser(panel.app, founding, "owner"), adminOne: await createUser(panel.app, founding, "admin"), operator: await createUser(panel.app, founding, "operator") };
}
// O dono do schema lê `accounts`, que nenhum papel do produto lê por fora de `packages/core`.
const accountOf = async (email: string): Promise<string> =>
  (await withOrg(owner, "00000000-0000-4000-8000-000000000000", (q) => q.one<{ id: string }>("select id from accounts where email = $1", [email])))?.id ?? "";
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];

interface Overview {
  organizations: Array<{ id: string; name: string; founding: boolean }>;
  creation: { explicit: boolean; granted: Array<{ accountId: string }>; losing: Array<{ accountId: string }> };
}
const overview = async (cookie: string): Promise<Overview> => (await call(listOrganizations, { cookie })).data as Overview;
const shown = (creation: Overview["creation"]) => ({ granted: creation.granted.map((p) => p.accountId), losing: creation.losing.map((p) => p.accountId) });

describe("who does not administer the installation", () => {
  it("gets 403 on every route of the area, before the body is read", async () => {
    const { ownerOne, operator } = await singleClient();
    // O dono de uma organização que não é a fundadora não administra, nem antes da lista explícita.
    const other = await createOrganization(panel.app, "Outra");
    const otherOwner = await createUser(panel.app, other, "owner");
    const id = other;
    for (const cookie of [operator.cookie, otherOwner.cookie]) {
      const results = [
        await call(listOrganizations, { cookie }),
        await call(createOrganizationRoute, { method: "POST", cookie, body: { name: "X", shown: { granted: [], losing: [] }, keep: [] } }),
        await call(renameOrganization, { method: "PATCH", cookie, params: { id }, body: { name: "X" } }),
        await call(inviteOwner, { method: "POST", cookie, params: { id }, body: { email: "x@example.test", name: "X" } }),
        await call(listAdmins, { cookie }),
        await call(grantAdmin, { method: "POST", cookie, body: { email: operator.email } }),
        await call(revokeAdmin, { method: "DELETE", cookie, params: { id: await accountOf(ownerOne.email) } }),
        await call(listEvents, { cookie }),
        await call(suspensionPreview, { cookie, params: { id } }),
        await call(suspend, { method: "POST", cookie, params: { id }, body: { reason: "Um motivo comprido o bastante" } }),
        await call(reactivate, { method: "DELETE", cookie, params: { id } }),
        // Sem corpo válido: a recusa vem antes da leitura da entrada.
        await call(createOrganizationRoute, { method: "POST", cookie, body: {} }),
      ];
      expect(results.map(refusal)).toEqual(results.map(() => [403, "forbidden"]));
    }
    expect(refusal(await call(listOrganizations))).toEqual([401, "unauthenticated"]);
  });
});

describe("the installation area", () => {
  it("creates the second organization, telling who is marked and who stops administering, and the founding admin loses the area", async () => {
    const { ownerOne, adminOne } = await singleClient();
    // Antes da segunda, o administrador da fundadora administra a instalação, como antes.
    expect((await call(listOrganizations, { cookie: adminOne.cookie })).status).toBe(200);
    const before = await overview(ownerOne.cookie);
    expect(before.creation.explicit).toBe(false);
    expect(shown(before.creation)).toEqual({ granted: [await accountOf(ownerOne.email)], losing: [await accountOf(adminOne.email)] });

    const created = await call(createOrganizationRoute, { method: "POST", cookie: ownerOne.cookie, body: { name: "Cliente", shown: shown(before.creation), keep: [] } });
    expect(created.status).toBe(200);
    const { organizationId } = created.data as { organizationId: string };
    expect(refusal(await call(listOrganizations, { cookie: adminOne.cookie }))).toEqual([403, "forbidden"]);
    expect((await overview(ownerOne.cookie)).creation).toEqual({ explicit: true, granted: [], losing: [] });

    // Renomear e o convite do primeiro dono.
    expect((await call(renameOrganization, { method: "PATCH", cookie: ownerOne.cookie, params: { id: organizationId }, body: { name: "Cliente Novo" } })).data).toEqual({ id: organizationId, name: "Cliente Novo" });
    expect(refusal(await call(renameOrganization, { method: "PATCH", cookie: ownerOne.cookie, params: { id: "00000000-0000-4000-8000-000000000000" }, body: { name: "X" } }))).toEqual([404, "not_found"]);
    const invite = await call(inviteOwner, { method: "POST", cookie: ownerOne.cookie, params: { id: organizationId }, body: { email: "Dona.Nova@Example.test", name: "Dona" } });
    expect(invite.status).toBe(200);
    expect((invite.data as { link: string }).link).toMatch(/^https:\/\/panel\.test\/invite\/[A-Za-z0-9_-]{43}$/);
    // Um e-mail que já tem conta também pode ser convidado (fatia 3): a pessoa aceita com a senha dela.
    // O convite novo derruba o anterior.
    expect((await call(inviteOwner, { method: "POST", cookie: ownerOne.cookie, params: { id: organizationId }, body: { email: adminOne.email, name: "X" } })).status).toBe(200);

    const events = (await call(listEvents, { cookie: ownerOne.cookie })).data as Array<{ kind: string; organizationId: string | null; actorEmail: string | null }>;
    const ofOrganization = events.filter((event) => event.organizationId === organizationId);
    expect(ofOrganization.map((event) => event.kind)).toEqual(["first_owner_invited", "first_owner_invited", "organization_renamed", "organization_created"]);
    // O convite guarda quem o gerou: a conta da sessão, e não alguém que a rota escolha.
    expect(ofOrganization[0]?.actorEmail).toBe(ownerOne.email);
  });

  it("refuses creating when the list changed since the screen opened", async () => {
    const { founding, ownerOne } = await singleClient();
    const before = await overview(ownerOne.cookie);
    await createUser(panel.app, founding, "admin");
    expect(refusal(await call(createOrganizationRoute, { method: "POST", cookie: ownerOne.cookie, body: { name: "Cliente", shown: shown(before.creation), keep: [] } }))).toEqual([409, "installation_admins_changed"]);
  });

  it("adds and removes who administers, and never removes the last person", async () => {
    const { ownerOne, adminOne } = await singleClient();
    const before = await overview(ownerOne.cookie);
    await call(createOrganizationRoute, { method: "POST", cookie: ownerOne.cookie, body: { name: "Cliente", shown: shown(before.creation), keep: [] } });
    const ownerAccount = await accountOf(ownerOne.email);
    expect(refusal(await call(revokeAdmin, { method: "DELETE", cookie: ownerOne.cookie, params: { id: ownerAccount } }))).toEqual([409, "last_installation_admin"]);
    expect((await call(grantAdmin, { method: "POST", cookie: ownerOne.cookie, body: { email: adminOne.email } })).status).toBe(200);
    expect(refusal(await call(grantAdmin, { method: "POST", cookie: ownerOne.cookie, body: { email: "ninguem@example.test" } }))).toEqual([404, "email_not_found"]);
    const listed = (await call(listAdmins, { cookie: adminOne.cookie })).data as { explicit: boolean; admins: Array<{ email: string }> };
    expect(listed.explicit).toBe(true);
    expect(listed.admins.map((admin) => admin.email).sort()).toEqual([ownerOne.email, adminOne.email].sort());
    expect((await call(revokeAdmin, { method: "DELETE", cookie: adminOne.cookie, params: { id: ownerAccount } })).status).toBe(200);
    expect(refusal(await call(listAdmins, { cookie: ownerOne.cookie }))).toEqual([403, "forbidden"]);
  });
});

describe("suspending and reactivating (fatia 4b)", () => {
  const REASON = "Contrato encerrado em novembro";
  const tasksOf = async (organizationId: string) =>
    withSystem(panel.app, (q) => q.many<{ kind: string; status: string; last_error: string | null }>("select kind, status, last_error from tasks where organization_id = $1 order by created_at, kind", [organizationId]));
  // A fila é uma só para o banco inteiro: a tarefa daqui não pode sobrar para a rotina de outro arquivo.
  const queued: string[] = [];
  const enqueue = async (organizationId: string, kind: string) => {
    queued.push(organizationId);
    return withOrg(panel.app, organizationId, (q) => enqueueTask(q, { kind, payload: {}, runAt: NOW }));
  };
  afterEach(async () => {
    const organizations = queued.splice(0);
    await withSystem(panel.app, (q) => q.exec("delete from tasks where organization_id = any($1::uuid[])", [organizations]));
  });

  /** A fundadora e o cliente A, criado pela tela; quem administra é o dono da fundadora, que entra também em A. */
  async function twoClients() {
    const { founding, ownerOne, operator } = await singleClient();
    const before = await overview(ownerOne.cookie);
    const created = await call(createOrganizationRoute, { method: "POST", cookie: ownerOne.cookie, body: { name: "Cliente A", shown: shown(before.creation), keep: [] } });
    const { organizationId: a } = created.data as { organizationId: string };
    const onlyA = await createUser(panel.app, a, "owner");
    const adminInA = await withSystem(panel.app, async (q) => addMembership(q, { organizationId: a, accountId: await accountOf(ownerOne.email), name: "Ana em A", role: "owner" }));
    return { founding, a, ownerOne, operator, onlyA, adminInA: await openSession(panel.app, a, adminInA) };
  }

  it("suspends A from the installation area: cancels A's cancelable tasks, keeps the guard routine, and A's people see only the suspension", async () => {
    const { founding, a, ownerOne, operator, onlyA, adminInA } = await twoClients();
    await enqueue(a, "deliver_notification");
    await enqueue(a, "purge_transcripts");
    await enqueue(founding, "deliver_notification");

    // Quem não administra a instalação: 403, sem nada mudar.
    expect(refusal(await call(suspend, { method: "POST", cookie: operator.cookie, params: { id: a }, body: { reason: REASON } }))).toEqual([403, "forbidden"]);
    expect(refusal(await call(suspend, { method: "POST", cookie: onlyA.cookie, params: { id: a }, body: { reason: REASON } }))).toEqual([403, "forbidden"]);

    // As recusas de quem administra.
    expect(refusal(await call(suspend, { method: "POST", cookie: ownerOne.cookie, params: { id: a }, body: { reason: "curto" } }))).toEqual([400, "invalid_suspension_reason"]);
    expect(refusal(await call(suspend, { method: "POST", cookie: ownerOne.cookie, params: { id: a }, body: { reason: "x".repeat(501) } }))).toEqual([400, "invalid_suspension_reason"]);
    expect(refusal(await call(suspend, { method: "POST", cookie: ownerOne.cookie, params: { id: founding }, body: { reason: REASON } }))).toEqual([409, "suspend_own_organization"]);
    expect(refusal(await call(suspend, { method: "POST", cookie: ownerOne.cookie, params: { id: "00000000-0000-4000-8000-000000000000" }, body: { reason: REASON } }))).toEqual([404, "not_found"]);
    expect(refusal(await call(reactivate, { method: "DELETE", cookie: ownerOne.cookie, params: { id: a } }))).toEqual([409, "organization_not_suspended"]);

    // A confirmação diz quantas serão canceladas; a lista diz qual é a da sessão.
    expect((await call(suspensionPreview, { cookie: ownerOne.cookie, params: { id: a } })).data).toEqual({ cancelableTasks: 1 });
    const listed = (await overview(ownerOne.cookie)).organizations as unknown as Array<{ id: string; current: boolean; suspendedAt: string | null }>;
    expect(listed.find((organization) => organization.id === founding)?.current).toBe(true);
    expect(listed.find((organization) => organization.id === a)?.current).toBe(false);

    const suspended = await call(suspend, { method: "POST", cookie: ownerOne.cookie, params: { id: a }, body: { reason: `  ${REASON}  ` } });
    expect([suspended.status, suspended.data]).toEqual([200, { ok: true, canceledTasks: 1 }]);
    expect(refusal(await call(suspend, { method: "POST", cookie: ownerOne.cookie, params: { id: a }, body: { reason: REASON } }))).toEqual([409, "organization_already_suspended"]);
    expect(await tasksOf(a)).toEqual([
      { kind: "deliver_notification", status: "canceled", last_error: "organization_suspended" },
      { kind: "purge_transcripts", status: "queued", last_error: null },
    ]);
    expect((await tasksOf(founding)).map((task) => task.status)).toEqual(["queued"]);

    // Quem é só de A: as rotas da organização respondem 409; as da conta continuam.
    expect(refusal(await call(team, { cookie: onlyA.cookie }))).toEqual([409, "organization_suspended"]);
    expect(refusal(await call(me, { cookie: onlyA.cookie }))).toEqual([409, "organization_suspended"]);
    expect((await call(myOrganizations, { cookie: onlyA.cookie })).data).toEqual([{ organizationId: a, organizationName: "Cliente A", current: true }]);
    // Quem tem outra organização troca para ela.
    expect((await call(switchOrganization, { method: "POST", cookie: adminInA, body: { organizationId: founding } })).status).toBe(200);
    expect((await call(team, { cookie: adminInA })).status).toBe(200);

    // As duas auditorias.
    const events = (await call(listEvents, { cookie: ownerOne.cookie })).data as Array<{ kind: string; organizationId: string | null; actorEmail: string | null; payload: Record<string, unknown> }>;
    expect(events.filter((event) => event.organizationId === a && event.kind === "organization_suspended")).toEqual([
      expect.objectContaining({ actorEmail: ownerOne.email, payload: { reason: REASON, canceled_tasks: 1 } }),
    ]);
    const orgEvents = await withSystem(panel.app, (q) =>
      q.many<{ kind: string; payload: Record<string, unknown> }>("select kind, payload from organization_events where organization_id = $1 and kind like 'organization_s%'", [a]),
    );
    expect(orgEvents).toEqual([{ kind: "organization_suspended", payload: { reason: REASON, canceled_tasks: 1 } }]);
  });

  it("who administers the installation, standing in suspended A, still reaches the area and reactivates A; nothing canceled comes back", async () => {
    const { a, ownerOne, onlyA, adminInA } = await twoClients();
    await enqueue(a, "follow_up");
    expect((await call(suspend, { method: "POST", cookie: ownerOne.cookie, params: { id: a }, body: { reason: REASON } })).data).toEqual({ ok: true, canceledTasks: 1 });
    // Entrou durante a suspensão: a reativação a cancela.
    await enqueue(a, "deliver_webhook");

    expect(refusal(await call(team, { cookie: adminInA }))).toEqual([409, "organization_suspended"]);
    const listed = (await call(listOrganizations, { cookie: adminInA })).data as { organizations: Array<{ id: string; current: boolean; suspendedReason: string | null }> };
    expect(listed.organizations.find((organization) => organization.id === a)).toMatchObject({ current: true, suspendedReason: REASON });

    const reactivated = await call(reactivate, { method: "DELETE", cookie: adminInA, params: { id: a } });
    expect([reactivated.status, reactivated.data]).toEqual([200, { ok: true, canceledTasks: 1 }]);
    expect((await tasksOf(a)).map((task) => [task.kind, task.status])).toEqual([
      ["follow_up", "canceled"],
      ["deliver_webhook", "canceled"],
    ]);
    expect((await call(team, { cookie: onlyA.cookie })).status).toBe(200);
    expect((await call(me, { cookie: onlyA.cookie })).status).toBe(200);

    const events = (await call(listEvents, { cookie: ownerOne.cookie })).data as Array<{ kind: string; organizationId: string | null; payload: Record<string, unknown> }>;
    expect(events.filter((event) => event.organizationId === a).map((event) => event.kind).slice(0, 2)).toEqual(["organization_reactivated", "organization_suspended"]);
  });

  it("refuses suspending the last active organization of the installation", async () => {
    const { founding, a, ownerOne, adminInA } = await twoClients();
    await call(suspend, { method: "POST", cookie: ownerOne.cookie, params: { id: a }, body: { reason: REASON } });
    // O banco de teste é compartilhado: as outras organizações ativas ficam suspensas só aqui dentro.
    const rows = await withSystem(panel.app, (q) => q.many<{ id: string }>("update organizations set suspended_at = $2 where suspended_at is null and id <> $1 returning id", [founding, NOW]));
    try {
      expect(refusal(await call(suspend, { method: "POST", cookie: adminInA, params: { id: founding }, body: { reason: REASON } }))).toEqual([409, "last_active_organization"]);
    } finally {
      await withSystem(panel.app, (q) => q.exec("update organizations set suspended_at = null where id = any($1::uuid[])", [rows.map((row) => row.id)]));
    }
  });
});
