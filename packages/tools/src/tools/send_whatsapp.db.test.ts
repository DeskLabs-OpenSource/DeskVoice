import { withOrg, withSystem, type ApprovalOutcome } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { startFakeWaha } from "../../test/fake-waha";
import { createFixture, createUser, eventsOf, fakeFetch, fakeLookup, putSetting, notificationsOf, putWhatsAppConnector, secretKey, t0, type FakeContext } from "../../test/helpers";
import { runTool } from "../run-tool";
import { wahaSessionName } from "../connectors/waha";
import { createSendWhatsApp } from "./send_whatsapp";

const { app, owner } = openTestDbs();
const waha = await startFakeWaha();
afterAll(async () => {
  await waha.stop();
  await app.close();
  await owner.close();
});

const CALLER = "+5531999998888";
const tool = (net: { fetch: typeof fetch }) => createSendWhatsApp({ fetch: net.fetch, lookup: fakeLookup(), secretKey: () => secretKey });

type Wait = (approvalId: string, ctx: FakeContext) => Promise<ApprovalOutcome>;

/**
 * Chamada de CALLER com conector configurado (salvo pedido em contrário). `trust` liga
 * `whatsapp.trust_caller_id`: os testes que não são sobre a confirmação humana usam `true`.
 */
async function fixture(label: string, options: { connector?: "webhook" | "deskcomm" | null; direction?: "inbound" | "outbound"; trust?: boolean; onWait?: Wait } = {}): Promise<FakeContext> {
  const ctx = await createFixture(app, label, { onWait: options.onWait });
  const inbound = (options.direction ?? "inbound") === "inbound";
  await withSystem(app, (q) =>
    q.exec("update calls set direction = $2, from_e164 = $3, to_e164 = $4 where id = $1", [ctx.callId, inbound ? "inbound" : "outbound", inbound ? CALLER : "+553133334444", inbound ? "+553133334444" : CALLER]),
  );
  if (options.connector !== null) await putWhatsAppConnector(app, ctx.organizationId, options.connector ?? "webhook");
  if (options.trust !== undefined) await putSetting(app, ctx.organizationId, "whatsapp.trust_caller_id", options.trust, false);
  return ctx;
}

const approvalsOf = (ctx: FakeContext): Promise<{ id: string; question: string; context: unknown; status: string; default_on_timeout: string; expires_at: Date }[]> =>
  withSystem(app, (q) => q.many("select id, question, context, status, default_on_timeout, expires_at from approvals where call_id = $1", [ctx.callId]));
/** Um humano decide pelo painel enquanto a ferramenta espera. */
const humanDecides = (decision: "approved" | "denied"): Wait => async (approvalId) => {
  await withSystem(app, (q) => q.exec("update approvals set status = $2 where id = $1", [approvalId, decision]));
  return decision;
};

describe("send_whatsapp", () => {
  it.each(["webhook", "deskcomm"] as const)("com trust_caller_id ligado, sem `to`, envia direto para quem ligou pelo conector %s", async (type) => {
    const ctx = await fixture(`whatsapp ${type}`, { connector: type, trust: true });
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

  it("em chamada feita pelo agente, envia direto para o número chamado, sem confirmação, mesmo com trust_caller_id desligado", async () => {
    const ctx = await fixture("whatsapp outbound", { direction: "outbound" });
    const net = fakeFetch();
    expect(await runTool(tool(net), { text: "Oi" }, ctx)).toMatchObject({ ok: true, data: { to: CALLER } });
    // O número de origem da chamada feita é o da própria central: não é destino permitido.
    expect((await runTool(tool(net), { to: "+553133334444", text: "Oi" }, ctx)).ok).toBe(false);
    expect(net.requests).toHaveLength(1);
  });

  it("aceita o número de quem ligou escrito em formato livre: a comparação é em E.164", async () => {
    const ctx = await fixture("whatsapp formato livre", { trust: true });
    const net = fakeFetch();
    for (const to of ["(31) 99999-8888", "031999998888", "+55 31 99999 8888"]) {
      expect(await runTool(tool(net), { to, text: "Oi" }, ctx), to).toMatchObject({ ok: true, data: { to: CALLER } });
    }
    expect(net.requests.map((request) => (request.body as { to: string }).to)).toEqual([CALLER, CALLER, CALLER]);
  });

  it("envia direto para o WhatsApp de um membro da equipe, sem confirmação", async () => {
    const ctx = await fixture("whatsapp equipe");
    await createUser(app, ctx.organizationId, "+5531988887777");
    const net = fakeFetch();
    expect(await runTool(tool(net), { to: "31 98888-7777", text: "Cliente aguardando retorno." }, ctx)).toMatchObject({ ok: true, data: { to: "+5531988887777" } });
    expect(net.requests).toHaveLength(1);
  });

  it("o número de quem foi desativado deixa de contar como equipe", async () => {
    const ctx = await fixture("whatsapp desativado");
    const gone = await createUser(app, ctx.organizationId, "+5531988887777");
    await withOrg(app, ctx.organizationId, (q) => q.exec("update users set disabled_at = now() where id = $1", [gone]));
    const net = fakeFetch();
    const result = await runTool(tool(net), { to: "31 98888-7777", text: "Cliente aguardando retorno." }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/só posso enviar para o número desta ligação ou para a equipe/);
    expect(net.requests).toHaveLength(0);
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
    const ctx = await fixture("whatsapp limite", { trust: true });
    const net = fakeFetch();
    expect((await runTool(tool(net), { to: "+5511912345678", text: "recusado" }, ctx)).ok).toBe(false);
    for (let sent = 1; sent <= 5; sent++) expect((await runTool(tool(net), { text: `mensagem ${sent}` }, ctx)).ok, `envio ${sent}`).toBe(true);

    const sixth = await runTool(tool(net), { text: "mensagem 6" }, ctx);
    expect(sixth.ok).toBe(false);
    expect(sixth.message).toMatch(/limite de 5 mensagens por ligação/);
    expect(net.requests).toHaveLength(5);
  });

  it("recusa texto com mais de 1000 caracteres", async () => {
    const ctx = await fixture("whatsapp texto longo", { trust: true });
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
    const ctx = await fixture("whatsapp sem conector", { connector: null, trust: true });
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
    const ctx = await fixture("whatsapp recusado", { trust: true });
    const result = await runTool(tool(fakeFetch(() => new Response("nope", { status: 503 }))), { text: "Oi" }, ctx);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Não consegui concluir/) });
    expect((await eventsOf(app, ctx.callId)).at(-1)?.payload.error).toBe("WhatsApp connector (webhook) answered HTTP 503");
  });

  it("não envia para conector que aponta para a rede interna", async () => {
    const ctx = await fixture("whatsapp interno", { connector: null, trust: true });
    await putSetting(app, ctx.organizationId, "whatsapp.connector", { type: "webhook", url: "http://127.0.0.1:8080/send", token: "v1:x:y:z" });
    const net = fakeFetch();
    // Token inválido de propósito: prova que nem a configuração malformada vaza como exceção.
    const result = await runTool(tool(net), { text: "Oi" }, ctx);
    expect(result.ok).toBe(false);
    expect(net.requests).toEqual([]);
  });

  describe("número exibido na ligação recebida (forjável)", () => {
    it("por padrão pede confirmação humana, mostrando destino e texto exato, e só envia depois de aprovado", async () => {
      const net = fakeFetch();
      let requestsWhileWaiting = -1;
      const ctx = await fixture("whatsapp confirma", {
        onWait: async (approvalId, fixtureCtx) => {
          requestsWhileWaiting = net.requests.length;
          return humanDecides("approved")(approvalId, fixtureCtx);
        },
      });

      const result = await runTool(tool(net), { text: "Seu código é 4812." }, ctx);

      expect(result).toMatchObject({ ok: true, data: { to: CALLER } });
      expect(requestsWhileWaiting).toBe(0);
      expect(net.requests).toHaveLength(1);
      expect(ctx.waits).toEqual([{ approvalId: expect.any(String), timeoutMs: 120_000 }]);
      expect(ctx.said).toEqual([expect.stringMatching(/confirmando o envio/)]);

      const [approval] = await approvalsOf(ctx);
      expect(approval).toMatchObject({ status: "approved", default_on_timeout: "denied", expires_at: new Date(t0.getTime() + 120_000) });
      expect(approval?.question).toContain(CALLER);
      expect(approval?.question).toContain("Seu código é 4812.");
      expect(approval?.context).toEqual({ text: expect.stringMatching(/pode ser forjado/) });
      expect((await notificationsOf(app, ctx.organizationId)).map((notification) => notification.channel)).toEqual(["panel"]);
      expect((await eventsOf(app, ctx.callId)).map((event) => event.kind)).toEqual(["tool_called", "approval_requested", "approval_decided", "tool_result"]);
    });

    it("o mesmo vale quando o modelo informa o número de quem ligou em `to`", async () => {
      const ctx = await fixture("whatsapp confirma com to", { trust: false, onWait: humanDecides("denied") });
      const net = fakeFetch();
      expect((await runTool(tool(net), { to: "(31) 99999-8888", text: "Oi" }, ctx)).ok).toBe(false);
      expect(ctx.waits).toHaveLength(1);
      expect(net.requests).toEqual([]);
    });

    it("negado não envia e orienta o modelo", async () => {
      const ctx = await fixture("whatsapp negado", { onWait: humanDecides("denied") });
      const net = fakeFetch();
      const result = await runTool(tool(net), { text: "Oi" }, ctx);
      expect(result).toMatchObject({ ok: false, data: { outcome: "denied", decision: "denied" } });
      expect(result.message).toMatch(/não autorizou o envio/);
      expect(result.message).toMatch(/create_task/);
      expect(net.requests).toEqual([]);
    });

    it("expirado não envia: sem resposta vale a recusa", async () => {
      const ctx = await fixture("whatsapp expirado", { onWait: async () => "expired" });
      const net = fakeFetch();
      const result = await runTool(tool(net), { text: "Oi" }, ctx);
      expect(result).toMatchObject({ ok: false, data: { outcome: "expired", decision: "denied" } });
      expect(result.message).toMatch(/Ninguém confirmou o envio a tempo/);
      expect((await approvalsOf(ctx))[0]?.status).toBe("expired");
      expect(net.requests).toEqual([]);
    });

    it("não incomoda ninguém com confirmação quando o conector já barra o envio", async () => {
      const ctx = await fixture("whatsapp sem conector e sem confianca", { connector: null });
      const net = fakeFetch();
      expect((await runTool(tool(net), { text: "Oi" }, ctx)).message).toMatch(/não está configurado/);
      expect(ctx.waits).toEqual([]);
      expect(await approvalsOf(ctx)).toEqual([]);
    });

    it("from_e164 que não é telefone é tratado como chamada sem número", async () => {
      const ctx = await fixture("whatsapp from invalido", { trust: true });
      await withSystem(app, (q) => q.exec("update calls set from_e164 = 'anonymous' where id = $1", [ctx.callId]));
      const net = fakeFetch();
      const result = await runTool(tool(net), { text: "Oi" }, ctx);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/não tem número identificado/);
      // E o valor cru nunca vira destino, nem casando com o argumento.
      expect((await runTool(tool(net), { to: "anonymous", text: "Oi" }, ctx)).ok).toBe(false);
      expect(net.requests).toEqual([]);
    });
  });

  describe("limite por chamada com envios em paralelo", () => {
    /** `fetch` falso que demora: deixa as chamadas paralelas se cruzarem, se pudessem. */
    function slow(): { fetch: typeof fetch; requests: number } {
      const state = { requests: 0, fetch: undefined as unknown as typeof fetch };
      state.fetch = async () => {
        state.requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return new Response("ok");
      };
      return state;
    }

    it("com 4 envios registrados, de 3 pedidos em paralelo exatamente 1 é enviado e 2 são recusados", async () => {
      const ctx = await fixture("whatsapp paralelo", { trust: true });
      const fast = fakeFetch();
      for (let sent = 1; sent <= 4; sent++) expect((await runTool(tool(fast), { text: `mensagem ${sent}` }, ctx)).ok).toBe(true);

      const net = slow();
      const results = await Promise.all([1, 2, 3].map((n) => runTool(tool(net), { text: `paralela ${n}` }, ctx)));

      expect(results.map((result) => result.ok).sort()).toEqual([false, false, true]);
      expect(net.requests).toBe(1);
      for (const result of results.filter((entry) => !entry.ok)) expect(result.message).toMatch(/limite de 5 mensagens por ligação/);
    });

    it("conta o envio que já saiu mesmo antes de o tool_result estar gravado", async () => {
      const ctx = await fixture("whatsapp sem tool_result", { trust: true });
      const net = fakeFetch();
      const direct = tool(net);
      // Direto em `run`, sem `runTool`: nenhum tool_result chega ao banco, como no instante entre
      // a ferramenta voltar e o evento ser gravado.
      for (let sent = 1; sent <= 5; sent++) expect((await direct.run({ text: `mensagem ${sent}` }, ctx)).ok).toBe(true);
      expect((await direct.run({ text: "mensagem 6" }, ctx)).ok).toBe(false);
      expect(net.requests).toHaveLength(5);
    });

    it("uma chamada não gasta o limite de outra, e falha de uma não trava a fila", async () => {
      const first = await fixture("whatsapp fila a", { trust: true });
      const second = await fixture("whatsapp fila b", { trust: true });
      const failing = fakeFetch(() => new Response("no", { status: 500 }));
      const net = fakeFetch();
      const results = await Promise.all([runTool(tool(failing), { text: "falha" }, first), runTool(tool(net), { text: "ok 1" }, first), runTool(tool(net), { text: "ok 2" }, second)]);
      expect(results.map((result) => result.ok)).toEqual([false, true, true]);
    });
  });
});

describe("send_whatsapp pelo número conectado por QR Code (conector waha)", () => {
  const net = fakeFetch();
  const wahaTool = createSendWhatsApp({ fetch: net.fetch, lookup: fakeLookup(), secretKey: () => secretKey, waha: waha.options });
  /** Chamada de CALLER, com o conector `waha` gravado e a sessão da organização conectada. */
  async function connected(label: string, options: { trust?: boolean; onWait?: Wait; stored?: unknown } = {}): Promise<FakeContext> {
    const ctx = await fixture(label, { connector: null, trust: options.trust, onWait: options.onWait });
    await putSetting(app, ctx.organizationId, "whatsapp.connector", options.stored ?? { type: "waha" }, false);
    waha.connect(wahaSessionName(ctx.organizationId), "553133330000");
    waha.contacts.set("5531999998888", "553199998888@c.us");
    waha.sent.length = 0;
    return ctx;
  }

  it("confere o número, envia para o endereço canônico pela sessão da organização e não toca conector externo", async () => {
    const ctx = await connected("waha envia", { trust: true });
    expect(await runTool(wahaTool, { text: "Seu horário é amanhã às 10h." }, ctx)).toMatchObject({ ok: true, data: { to: CALLER } });
    expect(waha.sent).toEqual([{ session: wahaSessionName(ctx.organizationId), chatId: "553199998888@c.us", text: "Seu horário é amanhã às 10h." }]);
    expect(net.requests).toEqual([]);
  });

  it("ignora endereço gravado no conector: o WAHA é o da instalação, nunca o que o operador escreveu", async () => {
    const ctx = await connected("waha url forjada", { trust: true, stored: { type: "waha", url: "https://evil.example.com", token: "x" } });
    expect((await runTool(wahaTool, { text: "Oi" }, ctx)).ok).toBe(true);
    expect(waha.sent).toHaveLength(1);
    expect(net.requests).toEqual([]);
  });

  it("mantém a confirmação humana do número exibido: negado, nada sai", async () => {
    const ctx = await connected("waha confirma", { onWait: humanDecides("denied") });
    const result = await runTool(wahaTool, { text: "Seu código é 4812." }, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não autorizou o envio/);
    expect(waha.sent).toEqual([]);
  });

  it("mantém as regras de destino e o teto de 5 por ligação", async () => {
    const ctx = await connected("waha limites", { trust: true });
    expect((await runTool(wahaTool, { to: "+5511912345678", text: "terceiro" }, ctx)).message).toMatch(/só posso enviar para o número desta ligação ou para a equipe/);
    for (let sent = 1; sent <= 5; sent++) expect((await runTool(wahaTool, { text: `mensagem ${sent}` }, ctx)).ok).toBe(true);
    expect((await runTool(wahaTool, { text: "mensagem 6" }, ctx)).message).toMatch(/limite de 5 mensagens por ligação/);
    expect(waha.sent).toHaveLength(5);
  });

  it("número que não existe no WhatsApp vira recusa clara na linha do tempo, sem envio e sem contar no limite", async () => {
    const ctx = await connected("waha sem whatsapp", { trust: true });
    waha.contacts.clear();
    const result = await runTool(wahaTool, { text: "Oi" }, ctx);
    expect(result).toEqual({ ok: false, message: expect.stringContaining(`O número ${CALLER} não tem WhatsApp, e nada foi enviado.`) as string });
    expect((await eventsOf(app, ctx.callId)).at(-1)?.payload).toMatchObject({ name: "send_whatsapp", ok: false, message: result.message });
    expect(waha.sent).toEqual([]);
  });

  it("sessão que não está conectada: o envio falha com o motivo na linha do tempo, sem tentar reconectar", async () => {
    const ctx = await connected("waha caiu", { trust: true });
    const session = waha.sessions.get(wahaSessionName(ctx.organizationId));
    if (session) session.status = "FAILED";
    waha.requests.length = 0;
    const result = await runTool(wahaTool, { text: "Oi" }, ctx);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Não consegui concluir/) as string });
    expect((await eventsOf(app, ctx.callId)).at(-1)?.payload.error).toBe("The WhatsApp number of this installation is not connected (session is FAILED): connect it in Settings");
    expect(waha.requests.map((request) => request.method)).toEqual(["GET"]);
    expect(waha.sent).toEqual([]);
  });

  it("consulta de endereço indisponível não derruba o envio: a mensagem sai e a linha do tempo diz que o endereço não foi conferido", async () => {
    const ctx = await connected("waha sem consulta", { trust: true });
    waha.override("GET /api/contacts/check-exists", { status: 400, body: { message: "Enable NOWEB store" } });
    const result = await runTool(wahaTool, { text: "Oi" }, ctx);
    waha.override("GET /api/contacts/check-exists", undefined);
    expect(result).toMatchObject({ ok: true, data: { to: CALLER, addressVerified: false } });
    expect(waha.sent).toEqual([{ session: wahaSessionName(ctx.organizationId), chatId: "5531999998888@c.us", text: "Oi" }]);
    expect((await eventsOf(app, ctx.callId)).at(-1)?.payload.message).toMatch(/não confirmou o endereço deste número/);
  });

  it("sem a chave da instalação, falha dizendo isso em vez de enviar", async () => {
    const ctx = await connected("waha sem chave", { trust: true });
    const result = await runTool(createSendWhatsApp({ secretKey: () => secretKey, waha: { apiKey: "" } }), { text: "Oi" }, ctx);
    expect(result.ok).toBe(false);
    expect((await eventsOf(app, ctx.callId)).at(-1)?.payload.error).toMatch(/has no WAHA key/);
  });
});

