// O vínculo de suporte da instalação (`users.kind = 'support'`, R8 seção 3.6) nunca é escolhido,
// contado nem listado pelo painel. Cada caso roda também com um `member` igual, que precisa
// aparecer: sem o par, o teste passaria com a lista vazia.
import { randomUUID } from "node:crypto";
import { createAccount, createFollowUp, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, PASSWORD, call, createCall, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { PATCH as patchAgent } from "./agents/[id]/route";
import { PATCH as assign } from "./follow-ups/[id]/route";
import { GET as owners } from "./follow-ups/owners/route";
import { GET as team } from "./team/route";
import { DELETE as removeUser, PATCH as patchUser } from "./team/users/[id]/route";

const panel = startPanel();
afterAll(() => panel.close());

type Kind = "member" | "support";
const KINDS: Kind[] = ["support", "member"];

/**
 * Um vínculo criado por SQL, no pior caso: com telefone, WhatsApp e ativo (`disabled_at` nulo).
 * A fatia 5c nunca cria o de suporte assim; aqui ele existe para provar que nenhuma escolha o alcança.
 */
async function link(org: string, kind: Kind, role: "owner" | "admin" | "operator"): Promise<string> {
  const email = `${kind}-${randomUUID()}@example.test`;
  const accountId = await withSystem(panel.app, (q) => createAccount(q, { email, passwordHash: PASSWORD }));
  return insert(
    panel.app,
    org,
    `insert into users (organization_id, account_id, email, name, role, kind, phone_e164, whatsapp_e164, disabled_at)
     values ($1, $2, $3, $4, $5, $6, '+5531999990001', '+5531999990001', null) returning id`,
    [org, accountId, email, `Pessoa ${kind}`, role, kind],
  );
}

async function scene(label: string, kind: Kind) {
  const org = await createOrganization(panel.app, `${label} ${kind}`);
  const owner = await createUser(panel.app, org, "owner");
  const agent = await insert(panel.app, org, "insert into agents (organization_id, name, engine) values ($1, 'Recepção', 'simulated') returning id", [org]);
  const callId = await createCall(panel.app, org, NOW);
  return { org, owner, agent, callId };
}

const refusalOf = (result: { status: number; code: string | undefined }) => [result.status, result.code];
const ids = (data: unknown, key = ""): string[] => ((key ? (data as Record<string, unknown>)[key] : data) as Array<{ id: string }>).map((row) => row.id);

describe.each(KINDS)("a %s link in the same organization", (kind) => {
  const reached = kind === "member";

  it(reached ? "is offered as a follow-up owner" : "is never offered as a follow-up owner", async () => {
    const { org, owner } = await scene("owners", kind);
    const person = await link(org, kind, "admin");
    const listed = ids((await call(owners, { cookie: owner.cookie })).data);
    expect(listed.includes(person)).toBe(reached);
    expect(listed).toContain(owner.id);
  });

  it(reached ? "is accepted as the agent's follow-up owner" : "is refused as the agent's follow-up owner", async () => {
    const { org, owner, agent } = await scene("agent owner", kind);
    const person = await link(org, kind, "admin");
    const result = await call(patchAgent, { method: "PATCH", cookie: owner.cookie, params: { id: agent }, body: { followUpOwnerUserId: person } });
    if (reached) expect(result.data).toMatchObject({ followUpOwnerUserId: person });
    else expect([result.status, result.code]).toEqual([400, "owner_unavailable"]);
  });

  it(reached ? "is accepted as a follow-up's owner" : "is refused as a follow-up's owner", async () => {
    const { org, owner, agent, callId } = await scene("assign", kind);
    const person = await link(org, kind, "admin");
    const followUp = await withOrg(panel.app, org, (q) => createFollowUp(q, { callId, agentId: agent, title: "Retornar", details: "Detalhe.", dueAt: NOW }, NOW));
    const result = await call(assign, { method: "PATCH", cookie: owner.cookie, params: { id: followUp.id }, body: { ownerUserId: person } });
    if (reached) expect(result.data).toMatchObject({ ownerUserId: person });
    else expect([result.status, result.code]).toEqual([400, "owner_unavailable"]);
    const stored = await withOrg(panel.app, org, (q) => q.one<{ owner: string | null }>("select owner_user_id as owner from follow_ups where id = $1", [followUp.id]));
    expect(stored?.owner).toBe(reached ? person : null);
  });

  it(reached ? "is listed on the team screen" : "is not listed on the team screen", async () => {
    const { org, owner } = await scene("team list", kind);
    const person = await link(org, kind, "admin");
    const listed = ids((await call(team, { cookie: owner.cookie })).data, "people");
    expect(listed.includes(person)).toBe(reached);
    expect(listed).toContain(owner.id);
  });

  it(reached ? "counts as an owner, so the other owner can step down" : "does not count as an owner, so the last member owner cannot step down", async () => {
    const { org, owner } = await scene("last owner", kind);
    await link(org, kind, "owner");
    const disable = await call(patchUser, { method: "PATCH", cookie: owner.cookie, params: { id: owner.id }, body: { disabled: true } });
    if (reached) expect(disable.data).toMatchObject({ active: false });
    else expect([disable.status, disable.code]).toEqual([409, "last_owner"]);
    // Quem foi desativado perde a sessão: a remoção só se confere quando o dono continuou ativo.
    if (!reached) expect(refusalOf(await call(removeUser, { method: "DELETE", cookie: owner.cookie, params: { id: owner.id } }))).toEqual([409, "last_owner"]);
  });

  it(reached ? "is reachable from the team actions" : "is not reachable from the team actions (404, like another organization's)", async () => {
    const { org, owner } = await scene("team actions", kind);
    const person = await link(org, kind, "admin");
    const result = await call(patchUser, { method: "PATCH", cookie: owner.cookie, params: { id: person }, body: { role: "operator" } });
    if (reached) expect(result.data).toMatchObject({ role: "operator" });
    else expect(result.status).toBe(404);
  });
});
