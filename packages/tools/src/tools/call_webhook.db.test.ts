import { encryptSecret } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf, fakeFetch, fakeLookup, putSetting, secretKey } from "../../test/helpers";
import { runTool } from "../run-tool";
import { createCallWebhook } from "./call_webhook";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const tool = (net: { fetch: typeof fetch }, lookup = fakeLookup()) => createCallWebhook({ fetch: net.fetch, lookup, secretKey: () => secretKey });

async function fixture(label: string) {
  const ctx = await createFixture(app, label);
  await putSetting(app, ctx.organizationId, "webhooks.allowed", [
    { name: "consultar_pedido", url: "https://erp.example.com/orders", token: encryptSecret("erp-token", secretKey) },
    { name: "abrir_chamado", url: "https://desk.example.com/tickets" },
    { name: "interno", url: "http://192.168.0.20/admin" },
    { name: "rebind", url: "https://rebind.example.com/x" },
  ]);
  return ctx;
}

describe("call_webhook", () => {
  it("chama a URL cadastrada pelo nome, com o token decifrado, e devolve a resposta", async () => {
    const ctx = await fixture("webhook ok");
    const net = fakeFetch(() => new Response('{"status":"enviado"}'));
    const result = await runTool(tool(net), { name: "consultar_pedido", payload: { pedido: "1234" } }, ctx);

    expect(result).toMatchObject({ ok: true, data: { status: 200, body: '{"status":"enviado"}', truncated: false } });
    expect(net.requests).toEqual([
      { url: "https://erp.example.com/orders", method: "POST", headers: { authorization: "Bearer erp-token", "content-type": "application/json" }, body: { callId: ctx.callId, pedido: "1234" } },
    ]);
  });

  it("webhook sem token vai sem Authorization, e payload é opcional", async () => {
    const ctx = await fixture("webhook sem token");
    const net = fakeFetch();
    expect((await runTool(tool(net), { name: "abrir_chamado" }, ctx)).ok).toBe(true);
    expect(net.requests[0]?.headers).toEqual({ "content-type": "application/json" });
    expect(net.requests[0]?.body).toEqual({ callId: ctx.callId });
  });

  it("nome não cadastrado não chama nada e devolve os nomes que existem", async () => {
    const ctx = await fixture("webhook desconhecido");
    const net = fakeFetch();
    const result = await runTool(tool(net), { name: "https://evil.example.com/steal", payload: {} }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Cadastradas: consultar_pedido, abrir_chamado, interno, rebind/);
    expect(net.requests).toEqual([]);
  });

  it("o modelo não consegue informar URL: campo fora do contrato é ignorado e vale a URL cadastrada", async () => {
    const ctx = await fixture("webhook url");
    const net = fakeFetch();
    await runTool(tool(net), { name: "consultar_pedido", url: "https://evil.example.com" }, ctx);
    expect(net.requests.map((request) => request.url)).toEqual(["https://erp.example.com/orders"]);
  });

  it("recusa destino cadastrado que é interno ou que resolve para IP interno", async () => {
    const ctx = await fixture("webhook interno");
    const net = fakeFetch();
    const lookup = fakeLookup({ "rebind.example.com": ["169.254.169.254"] });
    for (const name of ["interno", "rebind"]) {
      const result = await runTool(tool(net, lookup), { name }, ctx);
      expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Não consegui concluir/) });
      expect((await eventsOf(app, ctx.callId)).at(-1)?.payload.error).toMatch(/non-public address/);
    }
    expect(net.requests).toEqual([]);
  });

  it("erro HTTP da integração volta como ok: false com o status", async () => {
    const ctx = await fixture("webhook 500");
    const result = await runTool(tool(fakeFetch(() => new Response("boom", { status: 500 }))), { name: "abrir_chamado" }, ctx);
    expect(result).toMatchObject({ ok: false, data: { status: 500, body: "boom" } });
    expect(result.message).toMatch(/HTTP 500/);
  });

  it("sem nenhum webhook cadastrado diz isso", async () => {
    const ctx = await createFixture(app, "webhook vazio");
    const result = await runTool(tool(fakeFetch()), { name: "qualquer" }, ctx);
    expect(result.message).toMatch(/Nenhuma integração está cadastrada/);
  });
});
