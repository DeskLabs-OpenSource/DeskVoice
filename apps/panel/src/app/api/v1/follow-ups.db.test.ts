import { createFollowUp, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { PATCH as patchAgent } from "./agents/[id]/route";
import { POST as close } from "./follow-ups/[id]/close/route";
import { PATCH as assign } from "./follow-ups/[id]/route";
import { GET as owners } from "./follow-ups/owners/route";
import { GET as list } from "./follow-ups/route";
import { GET as notifications } from "./notifications/route";
import { PATCH as patchMember } from "./team/users/[id]/route";

const panel = startPanel();
afterAll(() => panel.close());

const HOUR_MS = 60 * 60 * 1000;
interface Item {
  id: string;
  title: string;
  ownerUserId: string | null;
  ownerName: string | null;
  status: string;
  closingNote: string | null;
  closedByName: string | null;
  canChange: boolean;
}
type Listed = { items: Item[]; retentionDays: number | null; people?: Array<{ id: string; name: string }> };

/** Organização com dono, operador, outro operador, um agente e uma ligação; `open` abre uma pendência pelo núcleo. */
async function scene(label: string) {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  const operator = await createUser(panel.app, org, "operator");
  const colleague = await createUser(panel.app, org, "operator");
  const agent = await insert(panel.app, org, "insert into agents (organization_id, name, engine) values ($1, 'Recepção', 'simulated') returning id", [org]);
  const callId = await createCall(panel.app, org, NOW);
  const open = async (title: string, ownerUserId: string | null, dueInHours = 1): Promise<string> => {
    await withOrg(panel.app, org, (q) => q.exec("update agents set follow_up_owner_user_id = $2 where id = $1", [agent, ownerUserId]));
    const created = await withOrg(panel.app, org, (q) => createFollowUp(q, { callId, agentId: agent, title, details: "Detalhe.", dueAt: new Date(NOW.getTime() + dueInHours * HOUR_MS) }, NOW));
    return created.id;
  };
  return { org, owner, operator, colleague, agent, callId, open };
}
const view = async (cookie: string, name: string): Promise<Listed> => (await call(list, { cookie, query: `?view=${name}` })).data as Listed;
const titles = (listed: Listed): string[] => listed.items.map((item) => item.title).sort();

describe("the follow-ups screen", () => {
  it("lists open, mine, overdue and closed, and says which ones the person can change", async () => {
    const { operator, colleague, open } = await scene("follow-ups views");
    await open("Da equipe", null);
    await open("Do operador", operator.id);
    await open("Da colega, vencida", colleague.id, -2);

    expect(titles(await view(operator.cookie, "open"))).toEqual(["Da colega, vencida", "Da equipe", "Do operador"]);
    expect(titles(await view(operator.cookie, "mine"))).toEqual(["Do operador"]);
    expect(titles(await view(operator.cookie, "overdue"))).toEqual(["Da colega, vencida"]);
    expect(titles(await view(operator.cookie, "closed"))).toEqual([]);
    const byTitle = Object.fromEntries((await view(operator.cookie, "open")).items.map((item) => [item.title, item.canChange]));
    expect(byTitle).toEqual({ "Da equipe": true, "Do operador": true, "Da colega, vencida": false });
    expect((await call(list, { cookie: operator.cookie, query: "?view=all" })).code).toBe("validation_error");
  });

  it("an operator closes their own and the team's, never a colleague's; owners close any; the close shows on the call", async () => {
    const { owner, operator, colleague, callId, open } = await scene("follow-ups close");
    const team = await open("Da equipe", null);
    const theirs = await open("Da colega", colleague.id);

    const closed = await call(close, { method: "POST", cookie: operator.cookie, params: { id: team }, body: { status: "done", note: "Retornei, consulta marcada para 14/11." } });
    expect(closed.data).toMatchObject({ status: "done", closingNote: "Retornei, consulta marcada para 14/11.", closedByName: "Test operator" });
    expect((await call(close, { method: "POST", cookie: operator.cookie, params: { id: team }, body: { status: "done", note: "De novo." } })).code).toBe("follow_up_closed");

    const refused = await call(close, { method: "POST", cookie: operator.cookie, params: { id: theirs }, body: { status: "canceled", note: "Não é minha." } });
    expect([refused.status, refused.code]).toEqual([403, "forbidden"]);
    expect((await call(close, { method: "POST", cookie: owner.cookie, params: { id: theirs }, body: { status: "canceled", note: "" } })).code).toBe("validation_error");
    expect((await call(close, { method: "POST", cookie: owner.cookie, params: { id: theirs }, body: { status: "canceled", note: "Paciente desistiu." } })).data).toMatchObject({ status: "canceled" });

    // A tela da ligação lê as pendências dela e os nomes que os eventos citam.
    const ofCall = (await call(list, { cookie: operator.cookie, query: `?callId=${callId}` })).data as Listed;
    // As duas nasceram no mesmo instante: a ordem entre elas não é o que se confere.
    expect(ofCall.items.map((item) => [item.title, item.status]).sort()).toEqual([
      ["Da colega", "canceled"],
      ["Da equipe", "done"],
    ]);
    expect(ofCall.people?.map((person) => person.id).sort()).toEqual([owner.id, operator.id, colleague.id].sort());
  });

  it("changes the owner only to an active person, and the operator cannot take a colleague's", async () => {
    const { owner, operator, colleague, open } = await scene("follow-ups assign");
    const team = await open("Da equipe", null);
    const theirs = await open("Da colega", colleague.id);

    expect((await call(assign, { method: "PATCH", cookie: operator.cookie, params: { id: team }, body: { ownerUserId: operator.id } })).data).toMatchObject({ ownerUserId: operator.id, ownerName: "Test operator" });
    expect((await call(assign, { method: "PATCH", cookie: operator.cookie, params: { id: theirs }, body: { ownerUserId: operator.id } })).code).toBe("forbidden");
    expect((await call(assign, { method: "PATCH", cookie: owner.cookie, params: { id: theirs }, body: { ownerUserId: null } })).data).toMatchObject({ ownerUserId: null });
    await call(patchMember, { method: "PATCH", cookie: owner.cookie, params: { id: colleague.id }, body: { disabled: true } });
    expect((await call(assign, { method: "PATCH", cookie: owner.cookie, params: { id: team }, body: { ownerUserId: colleague.id } })).code).toBe("owner_unavailable");
    expect(((await call(owners, { cookie: operator.cookie })).data as Array<{ id: string }>).map((person) => person.id).sort()).toEqual([owner.id, operator.id].sort());
  });

  it("disabling a person returns their open follow-ups to the team, and their agents stop handing follow-ups to them", async () => {
    const { org, owner, colleague, agent, callId, open } = await scene("follow-ups disabled owner");
    const id = await open("Da colega", colleague.id);

    expect((await call(patchMember, { method: "PATCH", cookie: owner.cookie, params: { id: colleague.id }, body: { disabled: true } })).status).toBe(200);

    const [item] = (await view(owner.cookie, "open")).items;
    expect(item).toMatchObject({ id, ownerUserId: null });
    const events = await withOrg(panel.app, org, (q) => q.many<{ kind: string; payload: Record<string, unknown> }>("select kind, payload from call_events where call_id = $1 order by id", [callId]));
    expect(events.at(-1)).toEqual({ kind: "follow_up_assigned", payload: { followUpId: id, ownerUserId: null, dueAt: expect.any(String), status: "open", reason: "owner_disabled" } });
    const configured = await withOrg(panel.app, org, (q) => q.one<{ owner: string | null }>("select follow_up_owner_user_id as owner from agents where id = $1", [agent]));
    expect(configured?.owner).toBeNull();
  });

  it("the agent screen saves the follow-up owner, and refuses a person of another organization", async () => {
    const { owner, operator, agent } = await scene("follow-ups agent owner");
    const other = await scene("follow-ups agent owner other");
    expect((await call(patchAgent, { method: "PATCH", cookie: owner.cookie, params: { id: agent }, body: { followUpOwnerUserId: operator.id } })).data).toMatchObject({ followUpOwnerUserId: operator.id });
    const foreign = await call(patchAgent, { method: "PATCH", cookie: owner.cookie, params: { id: agent }, body: { followUpOwnerUserId: other.operator.id } });
    expect([foreign.status, foreign.code]).toEqual([404, "not_found"]);
  });

  it("the bell shows the follow-up title read through the id, with a fixed body", async () => {
    const { org, owner, open } = await scene("follow-ups bell");
    const id = await open("Retornar para Paula sobre o laudo", null);
    await withOrg(panel.app, org, (q) =>
      q.exec("insert into notifications (organization_id, follow_up_id, channel, body, status, created_at) values ($1, $2, 'panel', 'Pendência para agora', 'sent', $3)", [org, id, NOW]),
    );
    const shown = (await call(notifications, { cookie: owner.cookie })).data as Array<Record<string, unknown>>;
    expect(shown).toMatchObject([{ body: "Pendência para agora", followUpId: id, followUpTitle: "Retornar para Paula sobre o laudo", followUpStatus: "open" }]);
  });
});
