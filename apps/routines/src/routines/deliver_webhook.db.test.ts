import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, fakeFetch, fakeLookup, openTestDbs, putSetting, t0, task } from "../../test/helpers";
import deliverWebhook from "./deliver_webhook";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("deliver_webhook", () => {
  it("chama o webhook cadastrado pelo nome, com a chamada no corpo", async () => {
    const org = await createOrganization(app, "webhook routine");
    await putSetting(app, org, "webhooks.allowed", [{ name: "crm", url: "https://crm.example.com/calls" }]);
    const callId = await createCall(app, org, t0);
    const net = fakeFetch();
    await deliverWebhook.run(task(org, "deliver_webhook", { name: "crm", payload: { outcome: "completed" } }, callId), depsFor(app, { fetch: net.fetch, lookup: fakeLookup() }));
    expect(net.requests).toEqual([{ url: "https://crm.example.com/calls", method: "POST", headers: { "content-type": "application/json" }, body: { callId, outcome: "completed" } }]);
  });

  it("lança erro, para a fila tentar de novo, quando o destino responde erro, não está cadastrado ou o payload é inválido", async () => {
    const org = await createOrganization(app, "webhook routine errors");
    await putSetting(app, org, "webhooks.allowed", [{ name: "crm", url: "https://crm.example.com/calls" }]);
    const deps = depsFor(app, { fetch: fakeFetch(() => new Response("no", { status: 500 })).fetch, lookup: fakeLookup() });
    await expect(deliverWebhook.run(task(org, "deliver_webhook", { name: "crm" }), deps)).rejects.toThrow("Webhook crm answered HTTP 500");
    await expect(deliverWebhook.run(task(org, "deliver_webhook", { name: "outro" }), deps)).rejects.toThrow(/"outro" is not registered/);
    await expect(deliverWebhook.run(task(org, "deliver_webhook", {}), deps)).rejects.toThrow();
  });
});
