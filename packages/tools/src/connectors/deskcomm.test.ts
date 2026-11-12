import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeFetch, fakeLookup } from "../../test/helpers";
import { sendWhatsApp, type WhatsAppConnector, type WhatsAppMessage } from "./whatsapp";

const TOKEN = "token-do-conector";
const DESKCOMM: WhatsAppConnector = { type: "deskcomm", url: "https://crm.example.test/api/v1/messages", token: TOKEN };
const WEBHOOK: WhatsAppConnector = { type: "webhook", url: "https://hooks.example.test/aviso", token: TOKEN };

/** A mesma conta que quem recebe faz: HMAC-SHA256 de `<instante>.<corpo>`, com o token como chave. */
const esperada = (timestamp: string, body: string): string =>
  `sha256=${createHmac("sha256", TOKEN).update(`${timestamp}.${body}`).digest("hex")}`;

function enviar(connector: WhatsAppConnector, message: WhatsAppMessage, status = 200) {
  const net = fakeFetch(() => new Response("{}", { status }));
  const run = sendWhatsApp(connector, message, { fetch: net.fetch, lookup: fakeLookup() });
  return { net, run };
}

describe("conector HTTP", () => {
  it("manda número, texto e chamada, com o corpo assinado", async () => {
    const message = { to: "+5511900000000", text: "Sua remarcação ficou para sexta.", callId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" };
    const { net, run } = enviar(DESKCOMM, message);
    await run;

    const [request] = net.requests;
    expect(request?.url).toBe(DESKCOMM.url);
    expect(request?.method).toBe("POST");
    expect(request?.body).toEqual(message);
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);

    const timestamp = request?.headers["x-deskvoice-timestamp"] ?? "";
    expect(timestamp).toMatch(/^\d+$/);
    expect(request?.headers["x-deskvoice-signature"]).toBe(
      esperada(timestamp, JSON.stringify({ to: message.to, text: message.text, callId: message.callId })),
    );
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
    expect(request?.headers["x-deskvoice-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("recusa destino que responde fora de 2xx", async () => {
    const { run } = enviar(DESKCOMM, { to: "+5511900000000", text: "Oi" }, 502);
    await expect(run).rejects.toThrow("answered HTTP 502");
  });
});
