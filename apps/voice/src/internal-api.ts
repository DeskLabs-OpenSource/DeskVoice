import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { z, type ZodType } from "zod";
import { messageOf, silentLogger, type Logger } from "./log";
import type { TrunkHealth } from "./trunks";

export interface VoiceHealth {
  asterisk: { status: "ok" | "warn" | "fail"; detail: string };
  /** O WebSocket da chamada pelo navegador. */
  web: { status: "ok" | "warn" | "fail"; detail: string };
  trunks: TrunkHealth[];
}

type Refusal = { code: string; message: string };

export interface InternalApiHandlers {
  health(): Promise<VoiceHealth>;
  applyTrunks(input: { organizationId: string }): Promise<object>;
  outbound(input: { organizationId: string; agentId: string; toE164: string }): Promise<{ callId: string } | Refusal>;
  simulate(input: { organizationId: string; agentId: string }): Promise<{ callId: string } | Refusal>;
  /** Chamada pelo navegador: cria a chamada e o token de uso único que abre o WebSocket dela. */
  web(input: { organizationId: string; agentId: string; userId: string }): Promise<{ callId: string; token: string; expiresInSeconds: number } | Refusal>;
}

export interface InternalApiOptions {
  port: number;
  host?: string;
  /** `INTERNAL_TOKEN`. Vazio ou ausente: tudo é recusado, menos `/health`. */
  token: string | undefined;
  handlers: InternalApiHandlers;
  log?: Logger;
}

const MAX_BODY_BYTES = 64 * 1024;
const organization = z.strictObject({ organizationId: z.uuid() });
const outbound = z.strictObject({ organizationId: z.uuid(), agentId: z.uuid(), toE164: z.string().min(1).max(40) });
const simulate = z.strictObject({ organizationId: z.uuid(), agentId: z.uuid() });
const web = z.strictObject({ organizationId: z.uuid(), agentId: z.uuid(), userId: z.uuid() });

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Compara os resumos, que têm sempre o mesmo tamanho: o tempo não revela o tamanho nem o começo do token.
const digest = (text: string): Buffer => createHash("sha256").update(text).digest();
const sameToken = (given: string, expected: string): boolean => timingSafeEqual(digest(given), digest(expected));

async function readJson<T>(request: IncomingMessage, schema: ZodType<T>): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large", "The request body is too large.");
    chunks.push(chunk as Buffer);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new HttpError(400, "invalid_body", `The request body is not JSON (${messageOf(error)}).`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, "invalid_body", parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "));
  }
  return parsed.data;
}

/**
 * API interna: é por ela que o painel pede coisas ao processo de voz. Nunca é publicada para fora
 * da rede interna, e ainda assim exige o token: quem alcança a porta não origina ligação.
 */
export function startInternalApi(options: InternalApiOptions): Promise<{ port: number; close(): Promise<void> }> {
  const { handlers } = options;
  const log = options.log ?? silentLogger;

  async function route(request: IncomingMessage): Promise<{ status: number; body: object }> {
    const path = new URL(request.url ?? "/", "http://internal").pathname;
    const key = `${request.method} ${path}`;
    // A saúde não pede token: é o que o orquestrador de contêineres consulta, e não revela segredo.
    if (key === "GET /health") return { status: 200, body: await handlers.health() };

    const given = request.headers["x-internal-token"];
    if (!options.token) throw new HttpError(503, "internal_token_missing", "INTERNAL_TOKEN is not configured in the voice process, so every request is refused.");
    if (typeof given !== "string" || !sameToken(given, options.token)) throw new HttpError(401, "unauthorized", "Missing or wrong x-internal-token.");

    if (key === "POST /trunks/apply") return { status: 200, body: await handlers.applyTrunks(await readJson(request, organization)) };
    if (key === "POST /calls/outbound" || key === "POST /calls/simulate") {
      const result = key === "POST /calls/outbound" ? await handlers.outbound(await readJson(request, outbound)) : await handlers.simulate(await readJson(request, simulate));
      return { status: "callId" in result ? 200 : 409, body: result };
    }
    if (key === "POST /calls/web") {
      const result = await handlers.web(await readJson(request, web));
      return { status: "callId" in result ? 200 : 409, body: result };
    }
    throw new HttpError(404, "not_found", `No route for ${key}.`);
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    route(request)
      .catch((error: unknown) => {
        if (error instanceof HttpError) return { status: error.status, body: { code: error.code, message: error.message } };
        log("error", "internal api request failed", { url: request.url, error: messageOf(error) });
        return { status: 500, body: { code: "internal_error", message: "The voice process failed to handle the request. The reason is in its log." } };
      })
      .then(({ status, body }) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
