import { createHash } from "node:crypto";
import { encryptSecret, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf, fakeFetch, fakeLookup, putSetting, secretKey } from "../../test/helpers";
import { loadAllowedWebhooks, webhookTimeoutMs } from "../connectors/webhook";
import { UnsafeDestinationError } from "../net/safe-fetch";
import { MAX_CALL_WEBHOOK_PER_CALL, runTool } from "../run-tool";
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
      { url: "https://erp.example.com/orders", method: "POST", headers: { authorization: "Bearer erp-token", "content-type": "application/json", "idempotency-key": expect.stringMatching(/^[0-9a-f]{64}$/) }, body: { callId: ctx.callId, pedido: "1234" } },
    ]);
  });

  it("webhook sem token vai sem Authorization, e payload é opcional", async () => {
    const ctx = await fixture("webhook sem token");
    const net = fakeFetch();
    expect((await runTool(tool(net), { name: "abrir_chamado" }, ctx)).ok).toBe(true);
    expect(net.requests[0]?.headers).toEqual({ "content-type": "application/json", "idempotency-key": expect.stringMatching(/^[0-9a-f]{64}$/) });
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

  it("destino recusado pela guarda depois de o prazo esgotar segue recusado, sem desfecho desconhecido", async () => {
    const ctx = await fixture("webhook recusado tarde");
    let calls = 0;
    // Como o undici faz quando o `guardedLookup` recusa na conexão: embrulha em "fetch failed".
    // A recusa chega só depois do prazo, com o sinal já abortado.
    const lateRefusal: typeof fetch = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      throw new TypeError("fetch failed", { cause: new UnsafeDestinationError("rebind.example.com resolves to non-public address 169.254.169.254") });
    };
    const result = await runTool(createCallWebhook({ fetch: lateRefusal, lookup: fakeLookup(), timeoutMs: 5, secretKey: () => secretKey }), { name: "rebind" }, ctx);

    expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Não consegui concluir/) });
    expect(result).not.toHaveProperty("outcome");
    const last = (await eventsOf(app, ctx.callId)).at(-1);
    expect(last?.payload).not.toHaveProperty("outcome");
    expect(last?.payload.error).toMatch(/non-public address/);
    expect(calls).toBe(1);
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

  it("o destino que responde erro já recebeu o POST: a vaga do teto fica gasta, também depois de a memória esquecer", async () => {
    const ctx = await fixture("webhook teto");
    const net = fakeFetch(() => new Response("erro", { status: 500 }));
    // Nome que não existe não chama nada e não gasta vaga.
    expect(await runTool(tool(net), { name: "nao_existe" }, ctx)).toMatchObject({ ok: false, noEffect: true });
    for (let i = 0; i < MAX_CALL_WEBHOOK_PER_CALL; i += 1) expect((await runTool(tool(net), { name: "abrir_chamado" }, ctx)).ok).toBe(false);
    expect(net.requests).toHaveLength(MAX_CALL_WEBHOOK_PER_CALL);

    expect((await runTool(tool(net), { name: "abrir_chamado" }, ctx)).message).toContain(`limite de ${MAX_CALL_WEBHOOK_PER_CALL} chamadas a call_webhook`);
    // Um minuto parado: a conta volta do banco, que guardou as vagas gastas.
    ctx.advance(60_000);
    expect((await runTool(tool(net), { name: "abrir_chamado" }, ctx)).message).toContain(`limite de ${MAX_CALL_WEBHOOK_PER_CALL} chamadas a call_webhook`);
    expect(net.requests).toHaveLength(MAX_CALL_WEBHOOK_PER_CALL);
  });

  it("destino que passa do prazo: desfecho desconhecido, não erro, e a frase fica na linha do tempo", async () => {
    const ctx = await fixture("webhook lento");
    let calls = 0;
    // Servidor falso lento: só "responde" quando o prazo aborta o pedido.
    const slow: typeof fetch = (_input, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    };
    const result = await runTool(createCallWebhook({ fetch: slow, lookup: fakeLookup(), timeoutMs: 5, secretKey: () => secretKey }), { name: "abrir_chamado", payload: { assunto: "x" } }, ctx);

    expect(calls).toBe(1);
    expect(result).toEqual({
      ok: false,
      outcome: "unknown",
      message: 'A integração "abrir_chamado" não respondeu a tempo. Não sei se o pedido foi registrado. NÃO chame de novo sem antes confirmar com a pessoa; diga que vai verificar.',
    });
    const last = (await eventsOf(app, ctx.callId)).at(-1);
    expect(last?.kind).toBe("tool_result");
    expect(last?.payload).toMatchObject({ name: "call_webhook", ok: false, outcome: "unknown", message: expect.stringContaining("não respondeu a tempo"), spent: true });
    // Não é a falha genérica: nada de "Não consegui concluir" nem detalhe de erro.
    expect(last?.payload.error).toBeUndefined();
  });

  it("o prazo gravado no webhook vale: servidor que responde em 12 s dá desconhecido com 10 e responde com 15", { timeout: 30_000 }, async () => {
    const ctx = await createFixture(app, "webhook prazo");
    await putSetting(app, ctx.organizationId, "webhooks.allowed", [
      { name: "padrao", url: "https://slow.example.com/a", timeoutSeconds: 10 },
      { name: "paciente", url: "https://slow.example.com/b", timeoutSeconds: 15 },
    ]);
    // Servidor falso que leva 12 s para responder, e desiste se o pedido for abortado antes.
    const seen: Record<string, "answered" | "aborted"> = {};
    const slow: typeof fetch = (input, init) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          seen[String(input)] = "answered";
          resolve(new Response('{"ok":true}'));
        }, 12_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          seen[String(input)] = "aborted";
          reject(init.signal?.reason);
        });
      });
    const run = (name: string) => runTool(createCallWebhook({ fetch: slow, lookup: fakeLookup(), secretKey: () => secretKey }), { name }, ctx);

    const [short, long] = await Promise.all([run("padrao"), run("paciente")]);
    expect(short).toMatchObject({ ok: false, outcome: "unknown" });
    expect(long).toMatchObject({ ok: true, data: { status: 200, body: '{"ok":true}' } });
    // O de 10 s desistiu antes da resposta; o de 15 s esperou por ela.
    expect(seen).toEqual({ "https://slow.example.com/a": "aborted", "https://slow.example.com/b": "answered" });
  });

  it("lista gravada sem prazo continua valendo, com 10 s; prazo fora de 1 a 30 gravado por fora é recusado na leitura", async () => {
    const ctx = await createFixture(app, "webhook lista antiga");
    await putSetting(app, ctx.organizationId, "webhooks.allowed", [{ name: "antigo", url: "https://old.example.com/x" }]);
    const hooks = await withOrg(app, ctx.organizationId, (q) => loadAllowedWebhooks(q, secretKey));
    expect(hooks).toEqual([{ name: "antigo", url: "https://old.example.com/x", token: undefined }]);
    expect(webhookTimeoutMs(hooks[0]!)).toBe(10_000);
    expect((await runTool(tool(fakeFetch()), { name: "antigo" }, ctx)).ok).toBe(true);

    for (const bad of [0, 31]) {
      const value = JSON.stringify([{ name: "antigo", url: "https://old.example.com/x", timeoutSeconds: bad }]);
      await withOrg(app, ctx.organizationId, (q) => q.exec("update settings set value = $1 where key = 'webhooks.allowed'", [value]));
      await expect(withOrg(app, ctx.organizationId, (q) => loadAllowedWebhooks(q, secretKey))).rejects.toThrow(/malformed/);
    }
  });

  it("falha de rede segue como erro genérico, sem desfecho desconhecido", async () => {
    const ctx = await fixture("webhook rede");
    const down: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const result = await runTool(createCallWebhook({ fetch: down, lookup: fakeLookup(), secretKey: () => secretKey }), { name: "abrir_chamado" }, ctx);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Não consegui concluir/) });
    expect((await eventsOf(app, ctx.callId)).at(-1)?.payload).not.toHaveProperty("outcome");
  });

  it("Idempotency-Key: sha256 de ligação, nome e payload com chaves ordenadas; muda com o argumento e com a ligação", async () => {
    const ctx = await fixture("webhook chave");
    const other = await fixture("webhook chave outra");
    const net = fakeFetch();
    const keyOf = async (fixtureCtx: typeof ctx, payload: Record<string, unknown>) => {
      await runTool(tool(net), { name: "abrir_chamado", payload }, fixtureCtx);
      return net.requests.at(-1)?.headers["idempotency-key"];
    };

    const first = await keyOf(ctx, { pedido: "1234", cliente: { nome: "Ana", id: 7 } });
    const expected = createHash("sha256").update(`${ctx.callId}\nabrir_chamado\n{"cliente":{"id":7,"nome":"Ana"},"pedido":"1234"}`).digest("hex");
    expect(first).toBe(expected);
    // Mesma chamada de novo: mesma chave.
    expect(await keyOf(ctx, { pedido: "1234", cliente: { nome: "Ana", id: 7 } })).toBe(first);
    // Chaves em outra ordem, em todo nível: mesma chave.
    expect(await keyOf(ctx, { cliente: { id: 7, nome: "Ana" }, pedido: "1234" })).toBe(first);
    // Argumento diferente: outra chave.
    expect(await keyOf(ctx, { pedido: "1235", cliente: { nome: "Ana", id: 7 } })).not.toBe(first);
    // Outra ligação, mesmos dados: outra chave.
    expect(await keyOf(other, { pedido: "1234", cliente: { nome: "Ana", id: 7 } })).not.toBe(first);
  });

  it("Idempotency-Key muda com a integração", async () => {
    const ctx = await fixture("webhook chave nome");
    const net = fakeFetch();
    await runTool(tool(net), { name: "abrir_chamado", payload: { a: 1 } }, ctx);
    await runTool(tool(net), { name: "consultar_pedido", payload: { a: 1 } }, ctx);
    const [a, b] = net.requests.map((request) => request.headers["idempotency-key"]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
