import { describe, expect, it } from "vitest";
import { fakeLookup } from "../../test/helpers";
import { drippingPings, fakeMcp, sseEvent, tool, type FakeMcpOptions } from "../../test/mcp-server";
import { SafeFetchTimeoutError, UnsafeDestinationError } from "../net/safe-fetch";
import { callTool, listTools, MCP_LIST_MAX_PAGES, MCP_LIST_MAX_TOOLS, McpHttpError, McpProtocolError, type McpEndpoint } from "./client";

const server: McpEndpoint = { slug: "erp", url: "https://mcp.example.com/mcp", secret: "Bearer s3cret" };
const net = (fake: { fetch: typeof fetch }, timeoutMs?: number) => ({ fetch: fake.fetch, lookup: fakeLookup(), ...(timeoutMs !== undefined && { timeoutMs }) });

const TRANSPORTS = ["json", "sse"] as const;

describe.each(TRANSPORTS)("cliente MCP, resposta %s", (transport) => {
  const mcp = (options: FakeMcpOptions = {}) => fakeMcp({ transport, ...options });

  it("listTools abre a sessão, manda o segredo no cabeçalho cadastrado e devolve o retrato", async () => {
    const fake = mcp();
    const list = await listTools({ ...server, headerName: "X-Api-Key", secret: "chave" }, net(fake));
    expect(fake.requests.map((request) => request.rpc.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(fake.requests.every((request) => request.method === "POST" && request.url === server.url)).toBe(true);
    expect(fake.requests[0]?.headers).toMatchObject({ "x-api-key": "chave", accept: "application/json, text/event-stream", "content-type": "application/json" });
    expect(fake.requests[0]?.headers).not.toHaveProperty("mcp-session-id");
    expect(fake.requests[0]?.headers).not.toHaveProperty("authorization");
    // Depois do `initialize`, todo pedido leva a sessão e a versão combinadas.
    for (const request of fake.requests.slice(1)) expect(request.headers).toMatchObject({ "mcp-session-id": "sessao-1", "mcp-protocol-version": "2025-06-18", "x-api-key": "chave" });
    expect(list).toEqual({
      tools: [{ name: "consultar_pedido", description: "Descrição de consultar_pedido", inputSchema: tool("consultar_pedido").inputSchema, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), supported: true }],
      omitted: 0,
      incomplete: false,
    });
  });

  it("callTool chama numa sessão nova e junta só os itens de texto", async () => {
    const fake = mcp({ call: () => ({ content: [{ type: "text", text: "Pedido 1234: enviado" }, { type: "image", data: "x", mimeType: "image/png" }, { type: "text", text: "Chega amanhã" }] }) });
    const result = await callTool(server, "consultar_pedido", { pedido: "1234" }, net(fake));
    expect(result).toEqual({ isError: false, text: "Pedido 1234: enviado\nChega amanhã", dropped: 1 });
    expect(fake.requests.map((request) => request.rpc.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(fake.requests[2]?.rpc.params).toEqual({ name: "consultar_pedido", arguments: { pedido: "1234" } });
    expect(fake.requests[2]?.headers.authorization).toBe("Bearer s3cret");
  });

  it("servidor sem sessão: nenhum Mcp-Session-Id é inventado", async () => {
    const fake = mcp({ sessionId: null });
    await callTool(server, "consultar_pedido", {}, net(fake));
    for (const request of fake.requests) expect(request.headers).not.toHaveProperty("mcp-session-id");
  });

  it("isError: true volta como isError", async () => {
    const fake = mcp({ call: () => ({ content: [{ type: "text", text: "pedido não existe" }], isError: true }) });
    expect(await callTool(server, "consultar_pedido", {}, net(fake))).toEqual({ isError: true, text: "pedido não existe", dropped: 0 });
  });

  it("HTTP de erro vira McpHttpError", async () => {
    const fake = mcp({ override: (rpc) => (rpc.method === "tools/call" ? new Response("boom", { status: 500 }) : undefined) });
    await expect(callTool(server, "consultar_pedido", {}, net(fake))).rejects.toThrow(McpHttpError);
  });

  it.each<[string, FakeMcpOptions["override"]]>([
    ["JSON-RPC de erro", (rpc) => (rpc.method === "tools/call" ? { error: { code: -32602, message: "Unknown tool" } } : undefined)],
    ["resultado fora da forma", (rpc) => (rpc.method === "tools/call" ? { result: { content: "texto solto" } } : undefined)],
    ["versão do protocolo que o cliente não fala", (rpc) => (rpc.method === "initialize" ? { result: { protocolVersion: "1999-01-01", capabilities: {} } } : undefined)],
    ["envelope com membro a mais", (rpc) => (rpc.method === "tools/call" ? new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [] }, extra: 1 }), { headers: { "content-type": "application/json" } }) : undefined)],
    ["resposta a outro pedido", (rpc) => (rpc.method === "tools/call" ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 999, result: { content: [] } }), { headers: { "content-type": "application/json" } }) : undefined)],
    ["corpo que não é JSON", (rpc) => (rpc.method === "tools/call" ? new Response("<html>oi</html>", { headers: { "content-type": "text/html" } }) : undefined)],
    ["fluxo SSE que fecha sem a resposta", (rpc) => (rpc.method === "tools/call" ? new Response(": nada\n\n", { headers: { "content-type": "text/event-stream" } }) : undefined)],
    ["sessão com caractere inválido", (rpc) => (rpc.method === "initialize" ? new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }), { headers: { "content-type": "application/json", "mcp-session-id": "a b" } }) : undefined)],
  ])("fora do protocolo: %s", async (_label, override) => {
    const fake = mcp({ override });
    await expect(callTool(server, "consultar_pedido", {}, net(fake))).rejects.toThrow(McpProtocolError);
  });

  it("destino recusado pela guarda não sai", async () => {
    const fake = mcp();
    await expect(callTool({ ...server, url: "http://10.0.0.5/mcp" }, "x", {}, net(fake))).rejects.toThrow(UnsafeDestinationError);
    await expect(callTool({ ...server, url: "https://intranet.example.com/mcp" }, "x", {}, { fetch: fake.fetch, lookup: fakeLookup({ "intranet.example.com": ["192.168.0.9"] }) })).rejects.toThrow(UnsafeDestinationError);
    expect(fake.requests).toEqual([]);
  });

  it("prazo estourado vira SafeFetchTimeoutError", async () => {
    const fake = mcp({ override: (rpc, _index, signal) => (rpc.method === "tools/call" ? drippingPings(signal) : undefined) });
    await expect(callTool(server, "consultar_pedido", {}, net(fake, 50))).rejects.toThrow(SafeFetchTimeoutError);
  });
});

describe("cliente MCP: o pedido redirecionado falha, e nenhum segundo pedido sai", () => {
  const steps = ["initialize", "notifications/initialized", "tools/list", "tools/call"] as const;
  const cases = steps.flatMap((step) =>
    [307, 302].flatMap((status) =>
      [
        ["mesma origem", "/outro"],
        ["outra origem", "https://outro.example.com/mcp"],
      ].flatMap(([origin, location]) => [undefined, "X-Api-Key"].map((headerName) => ({ step, status, origin, location: location as string, headerName }))),
    ),
  );

  it.each(cases)("$step com $status para $origin, cabeçalho $headerName", async ({ step, status, location, headerName }) => {
    const fake = fakeMcp({ override: (rpc) => (rpc.method === step ? new Response(null, { status, headers: { location } }) : undefined) });
    const endpoint = { ...server, ...(headerName !== undefined && { headerName }) };
    const run = step === "tools/list" ? listTools(endpoint, net(fake)) : callTool(endpoint, "consultar_pedido", {}, net(fake));
    const error = await run.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(McpProtocolError);
    expect((error as McpProtocolError).location).toBe(location);
    // O último pedido que saiu é o redirecionado; nada foi ao `Location`.
    expect(fake.requests.map((request) => request.rpc.method)).toEqual(steps.slice(0, steps.indexOf(step) + 1).filter((method) => method !== (step === "tools/call" ? "tools/list" : "tools/call")));
    expect(fake.requests.every((request) => request.url === server.url)).toBe(true);
  });
});

describe("cliente MCP: tetos de leitura", () => {
  it("initialize e tools/call acima de 16 KiB são fora do protocolo", async () => {
    const big = "x".repeat(20_000);
    for (const method of ["initialize", "tools/call"]) {
      const fake = fakeMcp({ override: (rpc) => (rpc.method === method ? { result: { protocolVersion: "2025-06-18", capabilities: {}, content: [{ type: "text", text: big }] } } : undefined) });
      await expect(callTool(server, "consultar_pedido", {}, net(fake)), method).rejects.toThrow(/larger than the limit/);
    }
  });

  it("resposta cortada nunca vale, mesmo quando o pedaço lido é JSON válido", async () => {
    // O JSON inteiro cabe no teto; o que passa dele são espaços. Ler `truncated` como sucesso aceitaria.
    const fake = fakeMcp({
      override: (rpc) =>
        rpc.method === "tools/call" ? new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: "ok" }] } }) + " ".repeat(20_000), { headers: { "content-type": "application/json" } }) : undefined,
    });
    await expect(callTool(server, "consultar_pedido", {}, net(fake))).rejects.toThrow(McpProtocolError);
  });

  it("tools/list cabe em até 256 KiB, somando as páginas; acima disso é fora do protocolo", async () => {
    const fat = (index: number) => tool(`t${index}`, { description: "d".repeat(900) });
    // ~95 KiB numa página: passa do teto padrão da safeFetch, e cabe no do tools/list.
    const one = await listTools(server, net(fakeMcp({ pages: [Array.from({ length: 95 }, (_, index) => fat(index))] })));
    expect(one.tools).toHaveLength(95);
    // Três páginas de ~95 KiB: cada uma cabe sozinha, a soma não.
    const pages = [0, 1, 2].map((page) => Array.from({ length: 95 }, (_, index) => fat(page * 100 + index)));
    const fake = fakeMcp({ pages });
    await expect(listTools(server, net(fake))).rejects.toThrow(McpProtocolError);
  });

  it(`tools/list com 101 ferramentas guarda ${MCP_LIST_MAX_TOOLS} e conta a que ficou de fora`, async () => {
    const fake = fakeMcp({ pages: [Array.from({ length: 60 }, (_, index) => tool(`a${index}`)), Array.from({ length: 41 }, (_, index) => tool(`b${index}`))] });
    const list = await listTools(server, net(fake));
    expect(list.tools).toHaveLength(MCP_LIST_MAX_TOOLS);
    expect(list.tools.at(-1)?.name).toBe("b39");
    expect(list).toMatchObject({ omitted: 1, incomplete: false });
  });

  it(`tools/list com 6 páginas lê ${MCP_LIST_MAX_PAGES} e diz que ficou incompleto`, async () => {
    const fake = fakeMcp({ pages: Array.from({ length: 6 }, (_, page) => [tool(`p${page}`)]) });
    const list = await listTools(server, net(fake));
    expect(list.tools.map((item) => item.name)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(list.incomplete).toBe(true);
    expect(fake.requests.filter((request) => request.rpc.method === "tools/list")).toHaveLength(MCP_LIST_MAX_PAGES);
  });

  it("SSE que goteja ping até o prazo estoura o prazo, no initialize e no tools/list", async () => {
    for (const method of ["initialize", "tools/list"]) {
      const fake = fakeMcp({ transport: "sse", override: (rpc, _index, signal) => (rpc.method === method ? drippingPings(signal) : undefined) });
      await expect(listTools(server, net(fake, 60)), method).rejects.toThrow(SafeFetchTimeoutError);
    }
  });

  it("o prazo é um só para a sessão inteira, e não um por pedido", async () => {
    // Cada pedido demora 40 ms; o prazo de 100 ms cabe em dois, não em três.
    const slow: typeof fetch = async (input, init) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 40);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        });
      });
      return fakeMcp().fetch(input, init);
    };
    await expect(callTool(server, "consultar_pedido", {}, { fetch: slow, lookup: fakeLookup(), timeoutMs: 100 })).rejects.toThrow(SafeFetchTimeoutError);
    expect(await callTool(server, "consultar_pedido", {}, { fetch: slow, lookup: fakeLookup(), timeoutMs: 1000 })).toMatchObject({ isError: false });
  });

  it("SSE que manda a resposta e não fecha: a chamada volta antes do prazo e o fluxo é cancelado", async () => {
    const fake = fakeMcp({ transport: "sse", keepOpen: true, before: [": ping\n\n", sseEvent({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "oi" } })] });
    // Prazo de 30 s, e o teste tem 5: só passa se a chamada não espera o fluxo fechar.
    const result = await callTool({ ...server, timeoutSeconds: 30 }, "consultar_pedido", {}, net(fake));
    expect(result.text).toBe("ok consultar_pedido");
    expect(fake.openedStreams).toBe(2);
    expect(fake.closedStreams).toBe(2);
  });

  it("SSE: evento da resposta maior que o teto vira corte e erro", async () => {
    const fake = fakeMcp({ transport: "sse", keepOpen: true, call: () => ({ content: [{ type: "text", text: "y".repeat(20_000) }] }) });
    await expect(callTool({ ...server, timeoutSeconds: 30 }, "consultar_pedido", {}, net(fake))).rejects.toThrow(/larger than the limit/);
  });
});

describe("cliente MCP: o retrato", () => {
  it("esquema fora do subconjunto e nome que não cabe ficam supported: false", async () => {
    const fake = fakeMcp({
      pages: [
        [
          tool("bom"),
          tool("com_ref", { inputSchema: { type: "object", properties: { a: { $ref: "#/defs/a" } } } }),
          tool("aninhado", { inputSchema: { type: "object", properties: { a: { type: "object", properties: {} } } } }),
          tool("nome com espaço"),
          tool("n".repeat(60)),
        ],
      ],
    });
    const list = await listTools(server, net(fake));
    expect(list.tools.map((item) => [item.name.slice(0, 16), item.supported])).toEqual([
      ["bom", true],
      ["com_ref", false],
      ["aninhado", false],
      ["nome com espaço", false],
      ["n".repeat(16), false],
    ]);
  });

  it("descrição cortada em 1.000 caracteres e impressão digital que muda com a descrição", async () => {
    const a = await listTools(server, net(fakeMcp({ pages: [[tool("x", { description: "a".repeat(1500) })]] })));
    const b = await listTools(server, net(fakeMcp({ pages: [[tool("x", { description: "b" })]] })));
    expect(a.tools[0]?.description).toHaveLength(1000);
    expect(a.tools[0]?.fingerprint).not.toBe(b.tools[0]?.fingerprint);
  });

  it("a dica readOnlyHint vem junto, só como dica", async () => {
    const list = await listTools(server, net(fakeMcp({ pages: [[tool("ler", { annotations: { readOnlyHint: true } })]] })));
    expect(list.tools[0]?.readOnlyHint).toBe(true);
  });
});
