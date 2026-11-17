// O vínculo de suporte da instalação (`users.kind = 'support'`, R8 seção 3.6) nunca vira responsável
// de pendência pelo núcleo: nem pelo dono configurado no agente, nem pela troca de dono. O mesmo
// caso com um `member` igual mostra que ele vira: sem o par, o teste passaria com ninguém.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, createCall, openTestDbs } from "../test/helpers";
import { createAccount } from "./accounts";
import { assignFollowUp, createFollowUp } from "./follow-ups";
import { withOrg, withSystem } from "./with-org";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const at = new Date("2026-04-01T13:00:00Z");
type Kind = "member" | "support";

/** Organização, um vínculo do `kind` dado (no pior caso: com WhatsApp e ativo), um agente e uma ligação. */
async function scene(kind: Kind) {
  const org = await createOrganization(app, `core support link ${kind}`);
  const email = `${kind}-${randomUUID()}@example.com`;
  const account = await withSystem(app, (q) => createAccount(q, { email, passwordHash: "x" }));
  const person = randomUUID();
  const agent = randomUUID();
  await withSystem(app, async (q) => {
    await q.exec(
      `insert into users (id, organization_id, account_id, email, name, role, kind, phone_e164, whatsapp_e164, disabled_at)
       values ($1, $2, $3, $4, 'Pessoa', 'admin', $5, '+5531999990001', '+5531999990001', null)`,
      [person, org, account, email, kind],
    );
    // Gravado direto, sem passar pela tela: o núcleo confere de novo na hora de abrir a pendência.
    await q.exec("insert into agents (id, organization_id, name, engine, follow_up_owner_user_id) values ($1, $2, 'Recepção', 'simulated', $3)", [agent, org, person]);
  });
  const call = await createCall(app, org, at);
  return { org, person, agent, call };
}

describe.each<Kind>(["support", "member"])("a %s link, for the core follow-ups", (kind) => {
  const reached = kind === "member";

  it(reached ? "becomes the owner configured on the agent" : "never becomes the owner, even when configured on the agent", async () => {
    const { org, person, agent, call } = await scene(kind);
    const created = await withOrg(app, org, (q) => createFollowUp(q, { callId: call, agentId: agent, title: "Retornar", details: "Detalhe.", dueAt: at }, at));
    const stored = await withOrg(app, org, (q) => q.one<{ owner: string | null }>("select owner_user_id as owner from follow_ups where id = $1", [created.id]));
    expect(stored?.owner).toBe(reached ? person : null);
  });

  it(reached ? "is accepted by assignFollowUp" : "is refused by assignFollowUp", async () => {
    const { org, person, call } = await scene(kind);
    const created = await withOrg(app, org, (q) => createFollowUp(q, { callId: call, agentId: null, title: "Retornar", details: "Detalhe.", dueAt: at }, at));
    expect(await withOrg(app, org, (q) => assignFollowUp(q, created.id, person, at))).toBe(reached ? "assigned" : "owner_unavailable");
  });
});
