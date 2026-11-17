import { FOUNDING_ORGANIZATION_KEY, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearInstallationState as clear, openTestDbs } from "../../../../../../packages/core/test/helpers";
import { NOW, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { DELETE as revokeAdmin } from "./installation/admins/[id]/route";
import { GET as listAdmins, POST as grantAdmin } from "./installation/admins/route";
import { GET as listEvents } from "./installation/events/route";
import { POST as inviteOwner } from "./installation/organizations/[id]/invite/route";
import { PATCH as renameOrganization } from "./installation/organizations/[id]/route";
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
    expect(refusal(await call(inviteOwner, { method: "POST", cookie: ownerOne.cookie, params: { id: organizationId }, body: { email: adminOne.email, name: "X" } }))).toEqual([400, "email_taken"]);

    const events = (await call(listEvents, { cookie: ownerOne.cookie })).data as Array<{ kind: string; organizationId: string | null; actorEmail: string | null }>;
    const ofOrganization = events.filter((event) => event.organizationId === organizationId);
    expect(ofOrganization.map((event) => event.kind)).toEqual(["first_owner_invited", "organization_renamed", "organization_created"]);
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
