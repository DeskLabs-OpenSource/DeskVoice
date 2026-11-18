import { describe, expect, it } from "vitest";
import { z } from "zod";
import { byStatus, checkKeyOverHttp } from "./key-check";

const REQUEST = { url: "https://provedor.invalid/v1/models", headers: { authorization: "Bearer chave-inventada" }, model: "modelo", accepted: z.object({ ok: z.literal(true) }) };

describe("byStatus: a regra geral do status no teste da chave", () => {
  it.each([500, 502, 503, 504, 529])("%i é erro do lado do provedor (provider_error), e não falta de rede", (status) => {
    expect(byStatus(status)).toBe("provider_error");
  });

  it.each([
    [401, "rejected"],
    [403, "rejected"],
    [402, "no_credit"],
    [404, "model_unavailable"],
    [429, "rate_limited"],
    [400, "unexpected_response"],
    [408, "unexpected_response"],
  ] as const)("%i continua %s", (status, result) => {
    expect(byStatus(status)).toBe(result);
  });
});

describe("checkKeyOverHttp: sem resposta é unreachable; resposta 5xx é provider_error", () => {
  it("fetch que rejeita (DNS, conexão recusada, prazo) é unreachable", async () => {
    const fetch = (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof globalThis.fetch;
    expect(await checkKeyOverHttp(REQUEST, { fetch })).toEqual({ result: "unreachable", model: "modelo" });
  });

  it("502 com corpo HTML (página de um proxy) é provider_error", async () => {
    const fetch = (() => Promise.resolve(new Response("<html><body>502 Bad Gateway</body></html>", { status: 502, headers: { "content-type": "text/html" } }))) as unknown as typeof globalThis.fetch;
    expect(await checkKeyOverHttp(REQUEST, { fetch })).toEqual({ result: "provider_error", model: "modelo" });
  });

  it("o classify do provedor vence a regra geral, e sem palpite dele vale o status", async () => {
    const reply = (status: number) => (() => Promise.resolve(new Response("{}", { status }))) as unknown as typeof globalThis.fetch;
    expect((await checkKeyOverHttp({ ...REQUEST, classify: () => "rate_limited" }, { fetch: reply(503) })).result).toBe("rate_limited");
    expect((await checkKeyOverHttp({ ...REQUEST, classify: () => undefined }, { fetch: reply(503) })).result).toBe("provider_error");
  });
});
