import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf, fakeFetch, fakeLookup, putSetting, putWhatsAppConnector, secretKey } from "../../test/helpers";
import { runTool } from "../run-tool";
import { createSendWhatsApp } from "./send_whatsapp";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const deps = (net: { fetch: typeof fetch }) => ({ fetch: net.fetch, lookup: fakeLookup(), secretKey: () => secretKey });

describe("send_whatsapp", () => {
  it.each(["webhook", "deskcomm"] as const)("envia pelo conector %s com o número normalizado e o token decifrado", async (type) => {
    const ctx = await createFixture(app, `whatsapp ${type}`);
    await putWhatsAppConnector(app, ctx.organizationId, type);
    const net = fakeFetch();

    const result = await runTool(createSendWhatsApp(deps(net)), { to: "(31) 99999-8888", text: "Seu horário é amanhã às 10h." }, ctx);

    expect(result).toMatchObject({ ok: true, data: { to: "+5531999998888" } });
    expect(net.requests).toEqual([
      {
        url: "https://wa.example.com/send",
        method: "POST",
        headers: { authorization: "Bearer wa-token", "content-type": "application/json" },
        body: { to: "+5531999998888", text: "Seu horário é amanhã às 10h.", callId: ctx.callId },
      },
    ]);
  });

  it("sem conector devolve ok: false com mensagem clara e não chama a rede", async () => {
    const ctx = await createFixture(app, "whatsapp sem conector");
    const net = fakeFetch();
    const result = await runTool(createSendWhatsApp(deps(net)), { to: "31999998888", text: "Oi" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não está configurado/);
    expect(net.requests).toEqual([]);
  });

  it("recusa número que não é telefone, sem enviar", async () => {
    const ctx = await createFixture(app, "whatsapp numero ruim");
    await putWhatsAppConnector(app, ctx.organizationId);
    const net = fakeFetch();
    const result = await runTool(createSendWhatsApp(deps(net)), { to: "meu número", text: "Oi" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não é um telefone válido/);
    expect(net.requests).toEqual([]);
  });

  it("recusa do conector vira falha dizível, com o motivo só na linha do tempo", async () => {
    const ctx = await createFixture(app, "whatsapp recusado");
    await putWhatsAppConnector(app, ctx.organizationId);
    const result = await runTool(createSendWhatsApp(deps(fakeFetch(() => new Response("nope", { status: 503 })))), { to: "31999998888", text: "Oi" }, ctx);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Não consegui concluir/) });
    expect((await eventsOf(app, ctx.callId)).at(-1)?.payload.error).toBe("WhatsApp connector (webhook) answered HTTP 503");
  });

  it("não envia para conector que aponta para a rede interna", async () => {
    const ctx = await createFixture(app, "whatsapp interno");
    await putSetting(app, ctx.organizationId, "whatsapp.connector", { type: "webhook", url: "http://127.0.0.1:8080/send", token: "v1:x:y:z" });
    const net = fakeFetch();
    // Token inválido de propósito: prova que nem a configuração malformada vaza como exceção.
    const result = await runTool(createSendWhatsApp(deps(net)), { to: "31999998888", text: "Oi" }, ctx);
    expect(result.ok).toBe(false);
    expect(net.requests).toEqual([]);
  });
});
