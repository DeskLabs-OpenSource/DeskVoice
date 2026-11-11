import { encryptSecret, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createNotification, createOrganization, depsFor, fakeFetch, fakeLookup, openTestDbs, putSetting, putWhatsAppConnector, secretKey, t0, task } from "../../test/helpers";
import deliverNotification from "./deliver_notification";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const rowOf = (id: string): Promise<{ status: string; error: string | null } | null> => withSystem(app, (q) => q.one("select status, error from notifications where id = $1", [id]));
const run = (org: string, notificationId: string, net: { fetch: typeof fetch }): Promise<void> =>
  deliverNotification.run(task(org, "deliver_notification", { notificationId }), depsFor(app, { fetch: net.fetch, lookup: fakeLookup() }));

describe("deliver_notification", () => {
  it("painel: só marca como enviado, sem tocar a rede", async () => {
    const org = await createOrganization(app, "deliver panel");
    const id = await createNotification(app, org, "panel", null);
    const net = fakeFetch();
    await run(org, id, net);
    expect(await rowOf(id)).toEqual({ status: "sent", error: null });
    expect(net.requests).toEqual([]);
  });

  it("whatsapp: envia pelo conector para o número do aviso", async () => {
    const org = await createOrganization(app, "deliver whatsapp");
    await putWhatsAppConnector(app, org);
    const callId = await createCall(app, org, t0);
    const id = await createNotification(app, org, "whatsapp", "+5531988887777", callId);
    const net = fakeFetch();
    await run(org, id, net);
    expect(net.requests).toEqual([
      { url: "https://wa.example.com/send", method: "POST", headers: { authorization: "Bearer wa-token", "content-type": "application/json" }, body: { to: "+5531988887777", text: "Cliente pediu retorno.", callId } },
    ]);
    expect(await rowOf(id)).toEqual({ status: "sent", error: null });
  });

  it("webhook: chama o webhook cadastrado com o nome do aviso", async () => {
    const org = await createOrganization(app, "deliver webhook");
    await putSetting(app, org, "webhooks.allowed", [{ name: "alertas", url: "https://alerts.example.com/in", token: encryptSecret("hook-token", secretKey) }]);
    const id = await createNotification(app, org, "webhook", "alertas");
    const net = fakeFetch();
    await run(org, id, net);
    expect(net.requests).toEqual([
      { url: "https://alerts.example.com/in", method: "POST", headers: { authorization: "Bearer hook-token", "content-type": "application/json" }, body: { notificationId: id, callId: null, body: "Cliente pediu retorno." } },
    ]);
    expect(await rowOf(id)).toEqual({ status: "sent", error: null });
  });

  it("falha de entrega marca failed com o erro e relança, e a nova tentativa que dá certo limpa o erro", async () => {
    const org = await createOrganization(app, "deliver failure");
    await putWhatsAppConnector(app, org);
    const id = await createNotification(app, org, "whatsapp", "+5531988887777");

    await expect(run(org, id, fakeFetch(() => new Response("down", { status: 502 })))).rejects.toThrow("WhatsApp connector (webhook) answered HTTP 502");
    expect(await rowOf(id)).toEqual({ status: "failed", error: "WhatsApp connector (webhook) answered HTTP 502" });

    await run(org, id, fakeFetch());
    expect(await rowOf(id)).toEqual({ status: "sent", error: null });
  });

  it("falha por configuração também fica registrada: sem conector, webhook não cadastrado, destino interno", async () => {
    const org = await createOrganization(app, "deliver misconfigured");
    await putSetting(app, org, "webhooks.allowed", [{ name: "interno", url: "http://10.0.0.8/hook" }]);
    const net = fakeFetch();

    const whatsapp = await createNotification(app, org, "whatsapp", "+5531988887777");
    await expect(run(org, whatsapp, net)).rejects.toThrow(/WhatsApp connector is not configured/);
    const unknown = await createNotification(app, org, "webhook", "https://evil.example.com/x");
    await expect(run(org, unknown, net)).rejects.toThrow(/is not registered/);
    const internal = await createNotification(app, org, "webhook", "interno");
    await expect(run(org, internal, net)).rejects.toThrow(/non-public address/);

    for (const id of [whatsapp, unknown, internal]) expect((await rowOf(id))?.status).toBe("failed");
    expect(net.requests).toEqual([]);
  });

  it("aviso já enviado não é enviado de novo", async () => {
    const org = await createOrganization(app, "deliver twice");
    await putWhatsAppConnector(app, org);
    const id = await createNotification(app, org, "whatsapp", "+5531988887777");
    const net = fakeFetch();
    await run(org, id, net);
    await run(org, id, net);
    expect(net.requests).toHaveLength(1);
  });

  it("não entrega aviso de outra organização", async () => {
    const org = await createOrganization(app, "deliver mine");
    const other = await createOrganization(app, "deliver theirs");
    const foreign = await createNotification(app, other, "panel", null);
    await expect(run(org, foreign, fakeFetch())).rejects.toThrow(/not found/);
    expect((await rowOf(foreign))?.status).toBe("pending");
  });
});
