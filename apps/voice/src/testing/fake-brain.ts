// O cérebro do pipeline num servidor falso: a OpenAI de verdade (`brains/openai`), com o `fetch` apontado
// para cá. Cada pedido responde o próximo roteiro da fila (SSE) ou um erro HTTP. Serve aos testes da
// sessão com o pipeline, à chamada pelo navegador e à prova de primeira impressão (fatia 5b-2).
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Reply = { status: number; body: string } | Array<{ data: unknown }>;

export async function startFakeBrain() {
  const replies: Reply[] = [];
  const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
  const open = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    request.on("end", () => {
      requests.push(JSON.parse(raw) as { messages: Array<Record<string, unknown>> });
      const reply = replies.shift() ?? [{ data: { choices: [{ index: 0, delta: { content: "(sem roteiro)" } }] } }];
      if (!Array.isArray(reply)) return void response.writeHead(reply.status, { "content-type": "application/json" }).end(reply.body);
      open.add(response);
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const step of reply) response.write(`data: ${JSON.stringify(step.data)}\n\n`);
      response.end("data: [DONE]\n\n");
      open.delete(response);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fetch = ((url: string, init: RequestInit) => globalThis.fetch(url.replace("https://api.openai.com", base), init)) as typeof globalThis.fetch;
  return {
    fetch,
    requests,
    reply: (...next: Reply[]) => void replies.push(...next),
    async stop() {
      for (const response of open) response.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export const text = (content: string) => ({ data: { choices: [{ index: 0, delta: { content } }] } });
export const usage = (prompt: number, completion: number) => ({ data: { choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion } } });
export const tool = (id: string, name: string, args: string) => ({
  data: { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args } }] }, finish_reason: "tool_calls" }] },
});

export type FakeBrain = Awaited<ReturnType<typeof startFakeBrain>>;
