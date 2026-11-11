import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, createUser, eventsOf, fakeFetch, fakeLookup, putSetting, putWhatsAppConnector, secretKey, type FakeContext } from "../../test/helpers";
import { runTool } from "../run-tool";
import { createSendWhatsApp } from "./send_whatsapp";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const CALLER = "+5531999998888";
const tool = (net: { fetch: typeof fetch }) => createSendWhatsApp({ fetch: net.fetch, lookup: fakeLookup(), secretKey: () => secretKey });

/** Chamada recebida de CALLER, com conector configurado (salvo pedido em contrário). */
async function fixture(label: string, options: { connector?: "webhook" | "deskcomm" | null; direction?: "inbound" | "outbound" } = {}): Promise<FakeContext> {
  const ctx = await createFixture(app, label);
  const inbound = (options.direction ?? "inbound") === "inbound";
  await withSystem(app, (q) =>
    q.exec("update calls set direction = $2, from_e164 = $3, to_e164 = $4 where id = $1", [ctx.callId, inbound ? "inbound" : "outbound", inbound ? CALLER : "+553133334444", inbound ? "+553133334444" : CALLER]),
  );
  if (options.connector !== null) await putWhatsAppConnector(app, ctx.organizationId, options.connector ?? "webhook");
  return ctx;
}

describe("send_whatsapp", () => {
  it.each(["webhook", "deskcomm"] as const)("sem `to`, envia para quem ligou pelo conector %s, com o token decifrado", async (type) => {
    const ctx = await fixture(`whatsapp ${type}`, { connector: type });
    const net = fakeFetch();

    const result = await runTool(tool(net), { text: "Seu horário é amanhã às 10h." }, ctx);

    expect(result).toMatchObject({ ok: true, data: { to: CALLER } });
    expect(net.requests).toEqual([
      {
        url: "https://wa.example.com/send",
        method: "POST",
        headers: { authorization: "Bearer wa-token", "content-type": "application/json" },
        body: { to: CALLER, text: "Seu horário é amanhã às 10h.", callId: ctx.callId },
      },
    ]);
  });

  it("em chamada feita pelo agente, quem está na linha é o número chamado", async () => {
    const ctx = await fixture("whatsapp outbound", { direction: "outbound" });
    const net = fakeFetch();
    expect(await runTool(tool(net), { text: "Oi" }, ctx)).toMatchObject({ ok: true, data: { to: CALLER } });
    // O número de origem da chamada feita é o da própria central: não é destino permitido.
    expect((await runTool(tool(net), { to: "+553133334444", text: "Oi" }, ctx)).ok).toBe(false);
    expect(net.requests).toHaveLength(1);
  });

  it("aceita o número de quem ligou escrito em formato livre: a comparação é em E.164", async () => {
    const ctx = await fixture("whatsapp formato livre");
    const net = fakeFetch();
    for (const to of ["(31) 99999-8888", "031999998888", "+55 31 99999 8888"]) {
      expect(await runTool(tool(net), { to, text: "Oi" }, ctx), to).toMatchObject({ ok: true, data: { to: CALLER } });
    }
    expect(net.requests.map((request) => (request.body as { to: string }).to)).toEqual([CALLER, CALLER, CALLER]);
  });

  it("envia para o WhatsApp de um membro da equipe", async () => {
    const ctx = await fixture("whatsapp equipe");
    await createUser(app, ctx.organizationId, "+5531988887777");
    const net = fakeFetch();
    expect(await runTool(tool(net), { to: "31 98888-7777", text: "Cliente aguardando retorno." }, ctx)).toMatchObject({ ok: true, data: { to: "+5531988887777" } });
    expect(net.requests).toHaveLength(1);
  });

  it("recusa número de terceiro, mesmo sendo da equipe de OUTRA organização, e orienta o modelo", async () => {
    const ctx = await fixture("whatsapp terceiro");
    const other = await createFixture(app, "whatsapp terceiro outra org");
    await createUser(app, other.organizationId, "+5531977776666");
    const net = fakeFetch();
    for (const to of ["+5511912345678", "+5531977776666"]) {
      const result = await runTool(tool(net), { to, text: "Clique neste link." }, ctx);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/só posso enviar para o número desta ligação ou para a equipe/);
      expect(result.message).toMatch(/request_approval/);
      expect(result.message).toMatch(/create_task/);
    }
    expect(net.requests).toEqual([]);
  });

  it("recusa depois de 5 envios na mesma chamada; envio recusado não conta", async () => {
    const ctx = await fixture("whatsapp limite");
    const net = fakeFetch();
    expect((await runTool(tool(net), { to: "+5511912345678", text: "recusado" }, ctx)).ok).toBe(false);
    for (let sent = 1; sent <= 5; sent++) expect((await runTool(tool(net), { text: `mensagem ${sent}` }, ctx)).ok, `envio ${sent}`).toBe(true);

    const sixth = await runTool(tool(net), { text: "mensagem 6" }, ctx);
    expect(sixth.ok).toBe(false);
    expect(sixth.message).toMatch(/limite de 5 mensagens por ligação/);
    expect(net.requests).toHaveLength(5);
  });

  it("recusa texto com mais de 1000 caracteres", async () => {
    const ctx = await fixture("whatsapp texto longo");
    const net = fakeFetch();
    expect((await runTool(tool(net), { text: "a".repeat(1000) }, ctx)).ok).toBe(true);
    const result = await runTool(tool(net), { text: "a".repeat(1001) }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("text");
    expect(net.requests).toHaveLength(1);
  });

  it("chamada sem número identificado: sem `to` não há para quem enviar", async () => {
    const ctx = await createFixture(app, "whatsapp anonimo");
    await putWhatsAppConnector(app, ctx.organizationId);
    const net = fakeFetch();
    const result = await runTool(tool(net), { text: "Oi" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não tem número identificado/);
    expect(net.requests).toEqual([]);
  });

  it("sem conector devolve ok: false com mensagem clara e não chama a rede", async () => {
    const ctx = await fixture("whatsapp sem conector", { connector: null });
    const net = fakeFetch();
    const result = await runTool(tool(net), { text: "Oi" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não está configurado/);
    expect(net.requests).toEqual([]);
  });

  it("recusa `to` que não é telefone, sem enviar", async () => {
    const ctx = await fixture("whatsapp numero ruim");
    const net = fakeFetch();
    const result = await runTool(tool(net), { to: "meu número", text: "Oi" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não é um telefone válido/);
    expect(net.requests).toEqual([]);
  });

  it("recusa do conector vira falha dizível, com o motivo só na linha do tempo, e não conta no limite", async () => {
    const ctx = await fixture("whatsapp recusado");
    const result = await runTool(tool(fakeFetch(() => new Response("nope", { status: 503 }))), { text: "Oi" }, ctx);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Não consegui concluir/) });
    expect((await eventsOf(app, ctx.callId)).at(-1)?.payload.error).toBe("WhatsApp connector (webhook) answered HTTP 503");
  });

  it("não envia para conector que aponta para a rede interna", async () => {
    const ctx = await fixture("whatsapp interno", { connector: null });
    await putSetting(app, ctx.organizationId, "whatsapp.connector", { type: "webhook", url: "http://127.0.0.1:8080/send", token: "v1:x:y:z" });
    const net = fakeFetch();
    // Token inválido de propósito: prova que nem a configuração malformada vaza como exceção.
    const result = await runTool(tool(net), { text: "Oi" }, ctx);
    expect(result.ok).toBe(false);
    expect(net.requests).toEqual([]);
  });
});
