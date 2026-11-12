import { encryptSecret, withSystem } from "@deskvoice/core";
import { wahaSessionName } from "@deskvoice/tools";
import { afterAll, describe, expect, it } from "vitest";
import { startFakeWaha } from "../../../../packages/tools/test/fake-waha";
import { createCall, createNotification, createOrganization, depsFor, fakeFetch, fakeLookup, openTestDbs, putSetting, putWhatsAppConnector, secretKey, t0, task } from "../../test/helpers";
import deliverNotification from "./deliver_notification";

const { app, owner } = openTestDbs();
const waha = await startFakeWaha();
afterAll(async () => {
  await waha.stop();
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
      { url: "https://wa.example.com/send", method: "POST", headers: { authorization: "Bearer wa-token", "content-type": "application/json", "idempotency-key": id }, body: { to: "+5531988887777", text: "Cliente pediu retorno.", callId } },
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

  it("whatsapp pelo número conectado (conector waha): confere o número e envia ao endereço canônico", async () => {
    const org = await createOrganization(app, "deliver waha");
    await putSetting(app, org, "whatsapp.connector", { type: "waha" }, false);
    waha.connect(wahaSessionName(org), "553133330000");
    waha.contacts.set("5531988887777", "553188887777@c.us");
    const id = await createNotification(app, org, "whatsapp", "+5531988887777");
    const net = fakeFetch();
    await deliverNotification.run(task(org, "deliver_notification", { notificationId: id }), depsFor(app, { fetch: net.fetch, lookup: fakeLookup(), waha: waha.options }));
    expect(waha.sent).toEqual([{ session: wahaSessionName(org), chatId: "553188887777@c.us", text: "Cliente pediu retorno." }]);
    expect(net.requests).toEqual([]);
    expect(await rowOf(id)).toEqual({ status: "sent", error: null });
  });

  it("conector waha: consulta de endereço indisponível não derruba a entrega, e a ressalva fica no aviso enviado", async () => {
    const org = await createOrganization(app, "deliver waha sem consulta");
    await putSetting(app, org, "whatsapp.connector", { type: "waha" }, false);
    waha.connect(wahaSessionName(org), "553133330000");
    waha.sent.length = 0;
    waha.override("GET /api/contacts/check-exists", { status: 400, body: { message: "Enable NOWEB store" } });
    const id = await createNotification(app, org, "whatsapp", "+5531988887777");
    await deliverNotification.run(task(org, "deliver_notification", { notificationId: id }), depsFor(app, { fetch: fakeFetch().fetch, lookup: fakeLookup(), waha: waha.options }));
    waha.override("GET /api/contacts/check-exists", undefined);
    expect(waha.sent).toEqual([{ session: wahaSessionName(org), chatId: "5531988887777@c.us", text: "Cliente pediu retorno." }]);
    expect(await rowOf(id)).toEqual({ status: "sent", error: "sent without the WhatsApp service confirming the address of the number (check-exists unavailable)" });
  });

  it("conector waha: número sem WhatsApp e sessão desconectada ficam no aviso como falha com o motivo, e nada sai", async () => {
    const org = await createOrganization(app, "deliver waha falha");
    await putSetting(app, org, "whatsapp.connector", { type: "waha" }, false);
    waha.connect(wahaSessionName(org), "553133330000");
    waha.sent.length = 0;
    const deps = depsFor(app, { fetch: fakeFetch().fetch, lookup: fakeLookup(), waha: waha.options });

    const unknown = await createNotification(app, org, "whatsapp", "+5531900001111");
    await expect(deliverNotification.run(task(org, "deliver_notification", { notificationId: unknown }), deps)).rejects.toThrow("+5531900001111 is not on WhatsApp");
    expect(await rowOf(unknown)).toEqual({ status: "failed", error: "+5531900001111 is not on WhatsApp" });

    const session = waha.sessions.get(wahaSessionName(org));
    if (session) session.status = "SCAN_QR_CODE";
    const offline = await createNotification(app, org, "whatsapp", "+5531988887777");
    await expect(deliverNotification.run(task(org, "deliver_notification", { notificationId: offline }), deps)).rejects.toThrow(/not connected \(session is SCAN_QR_CODE\)/);
    expect((await rowOf(offline))?.status).toBe("failed");
    expect(waha.sent).toEqual([]);
  });
});
