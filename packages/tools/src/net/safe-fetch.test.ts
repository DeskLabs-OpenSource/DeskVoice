import { describe, expect, it } from "vitest";
import { fakeFetch, fakeLookup } from "../../test/helpers";
import { isPublicAddress, safeFetch, UnsafeDestinationError } from "./safe-fetch";

const neverFetch: typeof fetch = async () => {
  throw new Error("fetch must not be called for a blocked destination");
};

describe("safeFetch", () => {
  it.each([
    ["loopback IPv4", "http://127.0.0.1/hook"],
    ["loopback escrito de outro jeito", "http://2130706433/hook"],
    ["rede privada 10.x", "http://10.1.2.3/hook"],
    ["rede privada 172.16.x", "http://172.16.0.9/hook"],
    ["rede privada 192.168.x", "https://192.168.0.10/hook"],
    ["metadados de nuvem", "http://169.254.169.254/latest/meta-data/"],
    ["endereço zero", "http://0.0.0.0/hook"],
    ["CGNAT", "http://100.64.0.1/hook"],
    ["loopback IPv6", "http://[::1]/hook"],
    ["IPv6 privado fd00::/8", "http://[fd00::1]/hook"],
    ["metadados de nuvem em IPv6", "http://[fd00:ec2::254]/hook"],
    ["link-local IPv6", "http://[fe80::1]/hook"],
    ["IPv4 embutido em IPv6", "http://[::ffff:127.0.0.1]/hook"],
    ["IPv4 privado embutido em IPv6", "http://[::ffff:10.0.0.1]/hook"],
  ])("recusa %s sem abrir conexão", async (_label, url) => {
    await expect(safeFetch(url, {}, { fetch: neverFetch, lookup: fakeLookup() })).rejects.toThrow(UnsafeDestinationError);
  });

  it.each(["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com/", "not a url"])("recusa %s: só http e https", async (url) => {
    await expect(safeFetch(url, {}, { fetch: neverFetch, lookup: fakeLookup() })).rejects.toThrow(UnsafeDestinationError);
  });

  it("recusa nome que resolve para IP privado, mesmo com um IP público junto", async () => {
    const lookup = fakeLookup({ "intranet.example.com": ["10.0.0.5"], "mixed.example.com": ["93.184.216.34", "127.0.0.1"], "v6.example.com": ["fd12::1"], "ghost.example.com": [] });
    for (const host of ["intranet.example.com", "mixed.example.com", "v6.example.com", "ghost.example.com"]) {
      await expect(safeFetch(`https://${host}/hook`, {}, { fetch: neverFetch, lookup }), host).rejects.toThrow(UnsafeDestinationError);
    }
  });

  it("recusa redirecionamento para destino privado, e não chama o destino", async () => {
    const { fetch, requests } = fakeFetch(() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
    await expect(safeFetch("https://public.example.com/hook", { method: "POST", body: "{}" }, { fetch, lookup: fakeLookup() })).rejects.toThrow(UnsafeDestinationError);
    expect(requests.map((request) => request.url)).toEqual(["https://public.example.com/hook"]);
  });

  it("recusa redirecionamento para nome que resolve para IP privado", async () => {
    const { fetch, requests } = fakeFetch(() => new Response(null, { status: 307, headers: { location: "https://intranet.example.com/x" } }));
    const lookup = fakeLookup({ "intranet.example.com": ["192.168.1.1"] });
    await expect(safeFetch("https://public.example.com/hook", {}, { fetch, lookup })).rejects.toThrow(/intranet\.example\.com/);
    expect(requests).toHaveLength(1);
  });

  it("chama um destino público e devolve status e corpo", async () => {
    const { fetch, requests } = fakeFetch(() => new Response('{"received":true}', { status: 201 }));
    const response = await safeFetch(
      "https://hooks.example.com/in",
      { method: "POST", headers: { Authorization: "Bearer s3cret", "Content-Type": "application/json" }, body: '{"a":1}' },
      { fetch, lookup: fakeLookup() },
    );
    expect(response).toEqual({ status: 201, ok: true, body: '{"received":true}', truncated: false });
    expect(requests).toEqual([{ url: "https://hooks.example.com/in", method: "POST", headers: { authorization: "Bearer s3cret", "content-type": "application/json" }, body: { a: 1 } }]);
  });

  it("aceita IP público literal sem consultar DNS", async () => {
    const { fetch } = fakeFetch();
    const lookup = async (): Promise<string[]> => {
      throw new Error("lookup must not be called for an IP literal");
    };
    expect((await safeFetch("http://93.184.216.34/x", {}, { fetch, lookup })).ok).toBe(true);
    expect((await safeFetch("http://[2606:2800:220:1:248:1893:25c8:1946]/x", {}, { fetch, lookup })).ok).toBe(true);
  });

  it("segue redirecionamento público, sem levar a credencial para outra origem", async () => {
    const { fetch, requests } = fakeFetch((request) =>
      request.url === "https://a.example.com/start" ? new Response(null, { status: 302, headers: { location: "https://b.example.com/end" } }) : new Response("done"),
    );
    const response = await safeFetch("https://a.example.com/start", { method: "POST", headers: { Authorization: "Bearer s3cret" }, body: "{}" }, { fetch, lookup: fakeLookup() });
    expect(response.body).toBe("done");
    expect(requests[1]).toEqual({ url: "https://b.example.com/end", method: "GET", headers: {}, body: undefined });
  });

  it("desiste depois de três redirecionamentos", async () => {
    let hop = 0;
    const { fetch, requests } = fakeFetch(() => new Response(null, { status: 308, headers: { location: `https://public.example.com/${++hop}` } }));
    await expect(safeFetch("https://public.example.com/0", {}, { fetch, lookup: fakeLookup() })).rejects.toThrow(/Too many redirects/);
    expect(requests).toHaveLength(4);
  });

  it("corta a resposta em 16 KB", async () => {
    const { fetch } = fakeFetch(() => new Response("x".repeat(40_000)));
    const response = await safeFetch("https://public.example.com/big", {}, { fetch, lookup: fakeLookup() });
    expect(response.body).toHaveLength(16 * 1024);
    expect(response.truncated).toBe(true);
  });

  it("passa ao fetch um sinal de tempo limite e nunca segue redirecionamento sozinho", async () => {
    let seen: RequestInit | undefined;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      seen = init;
      return new Response("ok");
    };
    await safeFetch("https://public.example.com/x", {}, { fetch, lookup: fakeLookup() });
    expect(seen?.redirect).toBe("manual");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborta quando o destino passa do tempo limite", async () => {
    const fetch: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    await expect(safeFetch("https://slow.example.com/x", {}, { fetch, lookup: fakeLookup(), timeoutMs: 1 })).rejects.toThrow(/timeout|aborted/i);
  });
});

describe("isPublicAddress", () => {
  it("separa público de interno", () => {
    expect(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2001:4860:4860::8888"].map(isPublicAddress)).toEqual([true, true, true, true]);
    expect(["172.31.255.255", "224.0.0.1", "255.255.255.255", "::", "ff02::1", "not-an-ip"].map(isPublicAddress)).toEqual([false, false, false, false, false, false]);
  });
});
