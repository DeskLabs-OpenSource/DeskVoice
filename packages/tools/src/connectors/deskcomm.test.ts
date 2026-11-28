import { randomBytes } from "node:crypto";
import { encryptSecret, type OrgQuery } from "@deskvoice/core";
import { describe, expect, it } from "vitest";
import { fakeFetch, fakeLookup, type RecordedRequest } from "../../test/helpers";
import { fakeMcp } from "../../test/mcp-server";
import { checkDeskcomm, DESKCOMM_CHECK_MAX_CHANNELS, loadWhatsAppConnector, sendWhatsApp, type WhatsAppConnector, type WhatsAppMessage } from "./whatsapp";

const TOKEN = "token-do-conector";
const DESKCOMM: WhatsAppConnector = { type: "deskcomm", url: "https://crm.example.test/api/v1/messages", token: TOKEN };
const WEBHOOK: WhatsAppConnector = { type: "webhook", url: "https://hooks.example.test/aviso", token: TOKEN };

function enviar(connector: WhatsAppConnector, message: WhatsAppMessage, status = 200) {
  const net = fakeFetch(() => new Response("{}", { status }));
  const run = sendWhatsApp(connector, message, { fetch: net.fetch, lookup: fakeLookup() });
  return { net, run };
}

describe("conector HTTP", () => {
  it("manda número, texto e chamada, com o token", async () => {
    const message = { to: "+5511900000000", text: "Sua remarcação ficou para sexta.", callId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" };
    const { net, run } = enviar(DESKCOMM, message);
    await run;

    const [request] = net.requests;
    expect(request?.url).toBe(DESKCOMM.url);
    expect(request?.method).toBe("POST");
    expect(request?.body).toEqual(message);
    expect(request?.headers).toEqual({ authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });
  });

  it("manda Idempotency-Key quando o aviso tem id, e não manda quando não tem", async () => {
    const comChave = enviar(DESKCOMM, { to: "+5511900000000", text: "Oi", idempotencyKey: "8a7b6c5d-0000-4000-8000-000000000001" });
    await comChave.run;
    expect(comChave.net.requests[0]?.headers["idempotency-key"]).toBe("8a7b6c5d-0000-4000-8000-000000000001");

    const semChave = enviar(DESKCOMM, { to: "+5511900000000", text: "Oi" });
    await semChave.run;
    expect(semChave.net.requests[0]?.headers).not.toHaveProperty("idempotency-key");
  });

  it("o conector webhook fala o mesmo formato do deskcomm", async () => {
    const comChave = enviar(WEBHOOK, { to: "+5511900000000", text: "Oi", idempotencyKey: "8a7b6c5d-0000-4000-8000-000000000002" });
    await comChave.run;

    const [request] = comChave.net.requests;
    expect(request?.url).toBe(WEBHOOK.url);
    expect(request?.body).toEqual({ to: "+5511900000000", text: "Oi", callId: null });
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers["idempotency-key"]).toBe("8a7b6c5d-0000-4000-8000-000000000002");
  });

  it("recusa destino que responde fora de 2xx", async () => {
    const { run } = enviar(DESKCOMM, { to: "+5511900000000", text: "Oi" }, 502);
    await expect(run).rejects.toThrow("answered HTTP 502");
  });
});

describe("conector deskcomm com o endereço do CRM (contrato do CRM, #330 fatia 2)", () => {
  const CRM = "https://crm.exemplo.com";
  const CANAL = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c77";
  const CONVERSA = "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f55";
  const CHAVE = "8a7b6c5d-0000-4000-8000-000000000003";
  // `url` é o intermediário antigo: com `crmUrl`, ele não é mais chamado.
  const COM_CRM: WhatsAppConnector = { type: "deskcomm", url: "https://intermediario.exemplo.com/wa", token: TOKEN, crmUrl: CRM };
  const COM_CANAL: WhatsAppConnector = { ...COM_CRM, channelSessionId: CANAL } as WhatsAppConnector;
  const aviso = { to: "+14155550123", text: "Vimos que sua ligação caiu.", callId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", idempotencyKey: CHAVE };

  function crm(responder: (request: RecordedRequest) => Response = (request) =>
    request.url.endsWith("/open-with-contact")
      ? new Response(JSON.stringify({ data: { conversation_id: CONVERSA, contact_id: "c3a4b5d6-1e2f-4a3b-8c4d-5e6f7a8b9c33" } }), { status: 200 })
      : new Response(JSON.stringify({ data: { id: "m-1" } }), { status: 201 })) {
    return fakeFetch(responder);
  }
  const net = (fake: ReturnType<typeof fakeFetch>) => ({ fetch: fake.fetch, lookup: fakeLookup() });

  it("sem canal escolhido: manda phone_number e body a /api/v1/messages, com o token e a chave", async () => {
    const fake = crm();

    await sendWhatsApp(COM_CRM, aviso, net(fake));

    expect(fake.requests).toEqual([
      {
        url: `${CRM}/api/v1/messages`,
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "idempotency-key": CHAVE },
        body: { phone_number: "+14155550123", body: "Vimos que sua ligação caiu." },
      },
    ]);
  });

  it("com canal escolhido: abre a conversa no canal e manda pela conversa; a chave vai só no envio", async () => {
    const fake = crm();

    await sendWhatsApp(COM_CANAL, aviso, net(fake));

    expect(fake.requests.map(({ url, body }) => ({ url, body }))).toEqual([
      { url: `${CRM}/api/v1/conversations/open-with-contact`, body: { phone_number: "+14155550123", channel_session_id: CANAL } },
      { url: `${CRM}/api/v1/messages`, body: { conversation_id: CONVERSA, body: "Vimos que sua ligação caiu." } },
    ]);
    expect(fake.requests[0]?.headers).not.toHaveProperty("idempotency-key");
    expect(fake.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(fake.requests[1]?.headers["idempotency-key"]).toBe(CHAVE);
  });

  it.each([
    ["canal desligado (409)", () => new Response(JSON.stringify({ error: { code: "state_conflict" } }), { status: 409 }), "answered HTTP 409"],
    ["resposta 2xx sem conversation_id", () => new Response(JSON.stringify({ data: {} }), { status: 200 }), "answered HTTP 502"],
    ["resposta que não é JSON", () => new Response("<html>", { status: 200 }), "answered HTTP 502"],
  ])("a conversa não abre (%s): erro, e a mensagem não sai", async (_label, abrir, erro) => {
    const fake = crm((request) => (request.url.endsWith("/open-with-contact") ? abrir() : new Response("{}", { status: 201 })));

    await expect(sendWhatsApp(COM_CANAL, aviso, net(fake))).rejects.toThrow(erro);
    expect(fake.requests.map(({ url }) => url)).toEqual([`${CRM}/api/v1/conversations/open-with-contact`]);
  });

  it("token só-MCP recusado pela rota REST: erro, para quem chama não ler enviado", async () => {
    const fake = crm(() => new Response(JSON.stringify({ error: { code: "forbidden" } }), { status: 403 }));

    await expect(sendWhatsApp(COM_CRM, aviso, net(fake))).rejects.toThrow("answered HTTP 403");
  });

  describe("a forma gravada", () => {
    const chave = randomBytes(32);
    const comConfiguracao = (value: unknown): OrgQuery => ({
      organizationId: "org-1",
      one: async <T>() => ({ value }) as T,
      many: async () => [],
      exec: async () => undefined,
    }) as unknown as OrgQuery;
    const gravado = { type: "deskcomm", url: "https://intermediario.exemplo.com/wa", token: encryptSecret(TOKEN, chave) };

    it("quem instalou antes, sem crmUrl: lê como sempre", async () => {
      expect(await loadWhatsAppConnector(comConfiguracao(gravado), chave)).toEqual({ type: "deskcomm", url: gravado.url, token: TOKEN });
    });

    it("com crmUrl e canal: lê os dois", async () => {
      expect(await loadWhatsAppConnector(comConfiguracao({ ...gravado, crmUrl: CRM, channelSessionId: CANAL }), chave)).toEqual({
        type: "deskcomm",
        url: gravado.url,
        token: TOKEN,
        crmUrl: CRM,
        channelSessionId: CANAL,
      });
    });

    it.each([
      ["crmUrl que não é http", { crmUrl: "ftp://crm.exemplo.com" }],
      ["canal que não é UUID", { crmUrl: CRM, channelSessionId: "sms-1" }],
    ])("%s: configuração malformada é erro", async (_label, extra) => {
      await expect(loadWhatsAppConnector(comConfiguracao({ ...gravado, ...extra }), chave)).rejects.toThrow("malformed");
    });
  });
});

describe("conferência das duas portas do CRM (#330 fatia 2b)", () => {
  const CRM = "https://crm.exemplo.com";
  const TOKEN_CRM = "dsk_token-de-teste";
  const CANAL = { id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c77", provider: "waha", display_name: "Número da loja", phone_number: "+19146200000", status: "connected" };

  /** O CRM falso: `/api/mcp` é o servidor MCP falso, e o resto é a REST, respondida por `rest`. */
  function crmFalso(options: { rest?: () => Response; mcp?: Parameters<typeof fakeMcp>[0] } = {}) {
    const mcp = fakeMcp(options.mcp);
    const rest = fakeFetch(options.rest ?? (() => Response.json({ data: [CANAL] })));
    const fetch: typeof globalThis.fetch = (input, init) => (String(input).endsWith("/api/mcp") ? mcp.fetch(input, init) : rest.fetch(input, init));
    return { mcp, rest, net: { fetch, lookup: fakeLookup() } };
  }

  it("as duas portas respondem: lê os tipos pelo MCP e lista os canais pela REST, com o mesmo token", async () => {
    const crm = crmFalso();
    const check = await checkDeskcomm({ crmUrl: CRM, token: TOKEN_CRM }, crm.net);

    expect(check).toEqual({ mcp: "ok", rest: "ok", channels: [{ id: CANAL.id, provider: "waha", name: "Número da loja", phone: "+19146200000" }] });
    const call = crm.mcp.requests.find((request) => request.rpc.method === "tools/call");
    expect(call?.url).toBe(`${CRM}/api/mcp`);
    expect(call?.rpc.params).toEqual({ name: "crm_list_event_types", arguments: {} });
    expect(call?.headers.authorization).toBe(`Bearer ${TOKEN_CRM}`);
    expect(crm.rest.requests).toHaveLength(1);
    expect(crm.rest.requests[0]).toMatchObject({ url: `${CRM}/api/v1/channel-sessions`, method: "GET" });
    expect(crm.rest.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN_CRM}`);
  });

  it("token só-MCP: o MCP aceita e a REST recusa, e nenhum canal volta", async () => {
    const crm = crmFalso({ rest: () => Response.json({ error: { code: "forbidden" } }, { status: 403 }) });
    expect(await checkDeskcomm({ crmUrl: CRM, token: TOKEN_CRM }, crm.net)).toEqual({ mcp: "ok", rest: "refused", channels: [] });
  });

  it("o MCP recusa o token por HTTP: refused, e a REST segue com o próprio resultado", async () => {
    const crm = crmFalso({ mcp: { override: () => new Response("", { status: 401 }) } });
    expect(await checkDeskcomm({ crmUrl: CRM, token: TOKEN_CRM }, crm.net)).toMatchObject({ mcp: "refused", rest: "ok" });
  });

  it("isError do MCP, HTTP de erro que não é recusa e corpo fora da forma são unexpected", async () => {
    const isError = crmFalso({ mcp: { call: () => ({ isError: true, content: [{ type: "text", text: "falhou" }] }) } });
    expect((await checkDeskcomm({ crmUrl: CRM, token: TOKEN_CRM }, isError.net)).mcp).toBe("unexpected");

    for (const rest of [() => new Response("", { status: 500 }), () => new Response("<html>", { status: 200 }), () => Response.json({ data: [{ id: "não-é-uuid", provider: "waha" }] })]) {
      expect(await checkDeskcomm({ crmUrl: CRM, token: TOKEN_CRM }, crmFalso({ rest }).net)).toMatchObject({ rest: "unexpected", channels: [] });
    }
  });

  it("CRM em endereço não público: as duas portas unreachable, sem pedido nenhum", async () => {
    const crm = crmFalso();
    const check = await checkDeskcomm({ crmUrl: CRM, token: TOKEN_CRM }, { fetch: crm.net.fetch, lookup: fakeLookup({ "crm.exemplo.com": ["10.0.0.5"] }) });
    expect(check).toEqual({ mcp: "unreachable", rest: "unreachable", channels: [] });
    expect(crm.mcp.requests).toHaveLength(0);
    expect(crm.rest.requests).toHaveLength(0);
  });

  it("a lista volta com no máximo o teto de canais, e o canal sem nome nem número chega com null", async () => {
    const muitos = Array.from({ length: DESKCOMM_CHECK_MAX_CHANNELS + 5 }, (_, index) => ({ id: `a1b2c3d4-e5f6-4a7b-8c9d-${String(index).padStart(12, "0")}`, provider: "waha" }));
    const check = await checkDeskcomm({ crmUrl: CRM, token: TOKEN_CRM }, crmFalso({ rest: () => Response.json({ data: muitos }) }).net);
    expect(check.channels).toHaveLength(DESKCOMM_CHECK_MAX_CHANNELS);
    expect(check.channels[0]).toEqual({ id: muitos[0]?.id, provider: "waha", name: null, phone: null });
  });
});
