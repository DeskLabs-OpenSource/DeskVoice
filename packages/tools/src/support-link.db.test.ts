// O vínculo de suporte da instalação (`users.kind = 'support'`, R8 seção 3.6) nunca recebe aviso nem
// conta como "equipe" para o `send_whatsapp`. O mesmo caso com um `member` igual mostra que ele
// recebe: sem o par, o teste passaria com ninguém recebendo nada.
import { randomUUID } from "node:crypto";
import { createAccount, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../core/test/helpers";
import { createFixture, fakeFetch, fakeLookup, notificationsOf, putWhatsAppConnector, secretKey } from "../test/helpers";
import { runTool } from "./run-tool";
import notifyHuman from "./tools/notify_human";
import { createSendWhatsApp } from "./tools/send_whatsapp";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

type Kind = "member" | "support";
const WHATSAPP = "+5531988887777";

/** O vínculo no pior caso: com telefone, WhatsApp e ativo (`disabled_at` nulo). */
async function link(organizationId: string, kind: Kind): Promise<void> {
  const id = randomUUID();
  await withSystem(app, async (q) => {
    const accountId = await createAccount(q, { email: `${id}@example.com`, passwordHash: "x" });
    await q.exec(
      `insert into users (id, organization_id, account_id, email, name, role, kind, phone_e164, whatsapp_e164, disabled_at)
       values ($1, $2, $3, $4, 'Pessoa', 'admin', $5, $6, $6, null)`,
      [id, organizationId, accountId, `${id}@example.com`, kind, WHATSAPP],
    );
  });
}

describe.each<Kind>(["support", "member"])("a %s link with WhatsApp, for the tools", (kind) => {
  const reached = kind === "member";

  it(reached ? "receives the WhatsApp notice from notify_human" : "never receives the WhatsApp notice from notify_human", async () => {
    const ctx = await createFixture(app, `notify ${kind}`);
    await putWhatsAppConnector(app, ctx.organizationId);
    await link(ctx.organizationId, kind);

    const result = await runTool(notifyHuman, { message: "Cliente pediu retorno." }, ctx);
    expect(result).toMatchObject({ ok: true, data: { channels: reached ? ["panel", "whatsapp"] : ["panel"] } });
    const targets = (await notificationsOf(app, ctx.organizationId)).filter((n) => n.channel === "whatsapp").map((n) => n.target);
    expect(targets).toEqual(reached ? [WHATSAPP] : []);
  });

  it(reached ? "counts as the team for send_whatsapp" : "does not count as the team for send_whatsapp, and nothing is sent", async () => {
    const ctx = await createFixture(app, `send_whatsapp ${kind}`);
    await putWhatsAppConnector(app, ctx.organizationId);
    await link(ctx.organizationId, kind);
    const net = fakeFetch();
    const tool = createSendWhatsApp({ fetch: net.fetch, lookup: fakeLookup(), secretKey: () => secretKey });

    const result = await runTool(tool, { to: "31 98888-7777", text: "Cliente aguardando retorno." }, ctx);
    if (reached) {
      expect(result).toMatchObject({ ok: true, data: { to: WHATSAPP } });
      expect(net.requests).toHaveLength(1);
    } else {
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/só posso enviar para o número desta ligação ou para a equipe/);
      expect(net.requests).toHaveLength(0);
    }
  });
});
