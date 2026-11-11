import { afterEach, describe, expect, it } from "vitest";
import { startInternalApi, type InternalApiHandlers } from "./internal-api";

const ORG = "0a000000-0000-4000-8000-000000000001";
const AGENT = "0b000000-0000-4000-8000-000000000002";
let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

async function api(token: string | undefined, overrides: Partial<InternalApiHandlers> = {}) {
  const calls: Array<[string, unknown]> = [];
  const handlers: InternalApiHandlers = {
    health: async () => ({ asterisk: { status: "fail", detail: "Asterisk is not reachable." }, web: { status: "ok", detail: "Listening." }, trunks: [{ id: "t1", status: "ok", detail: "The provider answers." }] }),
    applyTrunks: async (input) => (calls.push(["applyTrunks", input]), { applied: true }),
    outbound: async (input) => (calls.push(["outbound", input]), { callId: "call-1" }),
    simulate: async (input) => (calls.push(["simulate", input]), { callId: "call-2" }),
    web: async (input) => (calls.push(["web", input]), { callId: "call-3", token: "tok", expiresInSeconds: 60 }),
    ...overrides,
  };
  const server = await startInternalApi({ port: 0, host: "127.0.0.1", token, handlers });
  close = server.close;
  const request = async (method: string, path: string, options: { token?: string; body?: unknown; raw?: string } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(options.token !== undefined && { "x-internal-token": options.token }) },
      body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { request, calls };
}

describe("API interna", { timeout: 60_000 }, () => {
  it("sem token na requisição ou com token errado, recusa e não executa nada", async () => {
    const { request, calls } = await api("segredo-interno");
    const body = { organizationId: ORG, agentId: AGENT };
    expect(await request("POST", "/calls/simulate", { body })).toEqual({ status: 401, body: { code: "unauthorized", message: expect.any(String) } });
    for (const wrong of ["", "segredo-intern", "segredo-internoo", "SEGREDO-INTERNO", "x".repeat(4000)]) {
      expect((await request("POST", "/calls/simulate", { token: wrong, body })).status).toBe(401);
      expect((await request("POST", "/calls/outbound", { token: wrong, body: { ...body, toE164: "+5531999998888" } })).status).toBe(401);
      expect((await request("POST", "/trunks/apply", { token: wrong, body: { organizationId: ORG } })).status).toBe(401);
    }
    expect(calls).toEqual([]);
  });

  it("sem INTERNAL_TOKEN configurado recusa tudo, menos a saúde", async () => {
    for (const unset of [undefined, ""]) {
      const { request, calls } = await api(unset);
      expect(await request("POST", "/calls/simulate", { token: "", body: { organizationId: ORG, agentId: AGENT } })).toEqual({ status: 503, body: { code: "internal_token_missing", message: expect.any(String) } });
      expect((await request("POST", "/trunks/apply", { token: "qualquer", body: { organizationId: ORG } })).status).toBe(503);
      expect((await request("GET", "/health")).status).toBe(200);
      expect(calls).toEqual([]);
      await close?.();
    }
  });

  it("a saúde responde sem token, com o Asterisk e cada tronco separados", async () => {
    const { request } = await api("segredo-interno");
    expect(await request("GET", "/health")).toEqual({
      status: 200,
      body: { asterisk: { status: "fail", detail: "Asterisk is not reachable." }, web: { status: "ok", detail: "Listening." }, trunks: [{ id: "t1", status: "ok", detail: "The provider answers." }] },
    });
  });

  it("corpo inválido volta 400 dizendo o campo, sem executar", async () => {
    const { request, calls } = await api("segredo-interno");
    const token = "segredo-interno";
    const bad: Array<[string, { body?: unknown; raw?: string }]> = [
      ["/calls/simulate", { raw: "{ isto não é json" }],
      ["/calls/simulate", { body: { organizationId: ORG } }],
      ["/calls/simulate", { body: { organizationId: "não-é-uuid", agentId: AGENT } }],
      ["/calls/simulate", { body: { organizationId: ORG, agentId: AGENT, extra: true } }],
      ["/calls/simulate", { body: [ORG, AGENT] }],
      ["/calls/outbound", { body: { organizationId: ORG, agentId: AGENT } }],
      ["/calls/outbound", { body: { organizationId: ORG, agentId: AGENT, toE164: 5531 } }],
      ["/trunks/apply", { body: {} }],
      ["/trunks/apply", { raw: "" }],
    ];
    for (const [path, options] of bad) {
      const response = await request("POST", path, { token, ...options });
      expect(response, `${path} ${JSON.stringify(options)}`).toEqual({ status: 400, body: { code: "invalid_body", message: expect.any(String) } });
    }
    expect((await request("POST", "/calls/simulate", { token, body: { organizationId: ORG } })).body.message).toContain("agentId");
    expect((await request("POST", "/calls/simulate", { token, raw: JSON.stringify({ organizationId: ORG, agentId: AGENT, pad: "x".repeat(70_000) }) })).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("com token e corpo certos, chama o handler e devolve o que ele devolveu", async () => {
    const { request, calls } = await api("segredo-interno");
    const token = "segredo-interno";
    expect(await request("POST", "/calls/simulate", { token, body: { organizationId: ORG, agentId: AGENT } })).toEqual({ status: 200, body: { callId: "call-2" } });
    expect(await request("POST", "/calls/outbound", { token, body: { organizationId: ORG, agentId: AGENT, toE164: "+5531999998888" } })).toEqual({ status: 200, body: { callId: "call-1" } });
    expect(await request("POST", "/trunks/apply", { token, body: { organizationId: ORG } })).toEqual({ status: 200, body: { applied: true } });
    expect(calls).toEqual([
      ["simulate", { organizationId: ORG, agentId: AGENT }],
      ["outbound", { organizationId: ORG, agentId: AGENT, toE164: "+5531999998888" }],
      ["applyTrunks", { organizationId: ORG }],
    ]);
  });

  it("recusa do handler vira 409 com código e mensagem; rota desconhecida 404; falha interna 500 sem vazar o erro", async () => {
    const { request } = await api("segredo-interno", {
      outbound: async () => ({ code: "outside_window", message: "Outbound calls are allowed from 09:00 to 20:00." }),
      simulate: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.7:5432");
      },
    });
    const token = "segredo-interno";
    expect(await request("POST", "/calls/outbound", { token, body: { organizationId: ORG, agentId: AGENT, toE164: "+5531999998888" } })).toEqual({
      status: 409,
      body: { code: "outside_window", message: "Outbound calls are allowed from 09:00 to 20:00." },
    });
    expect((await request("GET", "/calls/simulate", { token })).status).toBe(404);
    const failed = await request("POST", "/calls/simulate", { token, body: { organizationId: ORG, agentId: AGENT } });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.7/);
  });

  it("POST /calls/web: exige o token interno, valida o corpo, devolve o token da chamada e repassa a recusa como 409", async () => {
    const USER = "0c000000-0000-4000-8000-000000000003";
    const body = { organizationId: ORG, agentId: AGENT, userId: USER };
    const { request, calls } = await api("segredo-interno");
    expect((await request("POST", "/calls/web", { body })).status).toBe(401);
    expect((await request("POST", "/calls/web", { token: "errado", body })).status).toBe(401);
    for (const bad of [{ organizationId: ORG, agentId: AGENT }, { ...body, userId: "eu" }, { ...body, extra: 1 }]) {
      expect((await request("POST", "/calls/web", { token: "segredo-interno", body: bad })).status).toBe(400);
    }
    expect(calls).toEqual([]);
    expect(await request("POST", "/calls/web", { token: "segredo-interno", body })).toEqual({ status: 200, body: { callId: "call-3", token: "tok", expiresInSeconds: 60 } });
    expect(calls).toEqual([["web", body]]);
    await close?.();

    const refusing = await api("segredo-interno", { web: async () => ({ code: "engine_simulated", message: "Change the agent's voice engine." }) });
    expect(await refusing.request("POST", "/calls/web", { token: "segredo-interno", body })).toEqual({ status: 409, body: { code: "engine_simulated", message: "Change the agent's voice engine." } });
  });
});
