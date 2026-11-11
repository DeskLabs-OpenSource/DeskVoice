import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, withOrg, type Db } from "@deskvoice/core";
import { vi } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { SESSION_COOKIE, createSession, setServerDeps, type Role, type RouteContext, type ServerDeps } from "../src/server/context";

export { createOrganization, createCall } from "../../../packages/core/test/helpers";

type Handler = (request: Request, context: RouteContext) => Promise<Response>;
type FakeFetch = (url: string, init: RequestInit) => Response | Promise<Response>;

export const NOW = new Date("2026-03-01T15:00:00.000Z");
export const SECRET_KEY = Buffer.alloc(32, 7);

/** Liga as rotas ao banco de teste, com relógio fixo e um processo de voz falso. */
export function startPanel(): { app: Db; deps: ServerDeps; clock: { at: Date }; voice: { respond: FakeFetch; requests: Array<{ url: string; body: unknown }> }; close(): Promise<void> } {
  // A senha usa o scrypt de produção (64 MiB por conta); em máquina carregada cada um leva segundos.
  vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
  const { app, owner } = openTestDbs();
  const clock = { at: NOW };
  const voice: { respond: FakeFetch; requests: Array<{ url: string; body: unknown }> } = {
    respond: () => {
      throw new Error("connect ECONNREFUSED");
    },
    requests: [],
  };
  const deps: ServerDeps = {
    db: app,
    clock: { now: () => clock.at },
    secretKey: SECRET_KEY,
    publicUrl: "https://panel.test",
    fetch: async (input, init = {}) => {
      const url = String(input);
      voice.requests.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      return voice.respond(url, init);
    },
    voiceUrl: "http://voice.test",
    internalToken: "internal-test-token",
    trustedProxyHops: 1,
    voiceWebPublicPort: undefined,
    verifyPassword,
  };
  setServerDeps(deps);
  return {
    app,
    deps,
    clock,
    voice,
    async close() {
      setServerDeps(undefined);
      await app.close();
      await owner.close();
    },
  };
}

// Um hash só para todos os usuários de teste: o scrypt de produção custa 64 MiB por conta.
export const PASSWORD = "correct horse battery";
let passwordHash: Promise<string> | undefined;

export async function createUser(app: Db, organizationId: string, role: Role): Promise<{ id: string; email: string; cookie: string }> {
  passwordHash ??= hashPassword(PASSWORD);
  const hash = await passwordHash;
  const email = `${role}-${randomUUID()}@example.test`;
  return withOrg(app, organizationId, async (q) => {
    const row = await q.one<{ id: string }>("insert into users (organization_id, email, name, password_hash, role) values ($1, $2, $3, $4, $5) returning id", [
      organizationId,
      email,
      `Test ${role}`,
      hash,
      role,
    ]);
    const id = row?.id ?? "";
    const token = await createSession(q, { id, organizationId }, NOW);
    return { id, email, cookie: `${SESSION_COOKIE}=${token}` };
  });
}

/** Mais uma sessão para a mesma pessoa (outro aparelho). */
export async function openSession(app: Db, organizationId: string, userId: string): Promise<string> {
  const token = await withOrg(app, organizationId, (q) => createSession(q, { id: userId, organizationId }, NOW));
  return `${SESSION_COOKIE}=${token}`;
}

export async function insert(app: Db, organizationId: string, sql: string, params: unknown[]): Promise<string> {
  const row = await withOrg(app, organizationId, (q) => q.one<{ id: string }>(sql, params));
  if (!row) throw new Error("fixture insert returned nothing");
  return row.id;
}

export interface Result {
  status: number;
  ok: boolean;
  data: unknown;
  code: string | undefined;
  message: string | undefined;
  text: string;
  headers: Headers;
}

/** Chama o manipulador da rota direto, como o Next chamaria. */
export async function call(
  handler: Handler | ((request: Request) => Promise<Response>),
  options: { method?: string; cookie?: string; body?: unknown; params?: Record<string, string>; query?: string; headers?: Record<string, string>; origin?: string } = {},
): Promise<Result> {
  const request = new Request(`${options.origin ?? "https://panel.test"}/api/v1/x${options.query ?? ""}`, {
    method: options.method ?? "GET",
    headers: { ...(options.cookie && { cookie: options.cookie }), ...(options.body !== undefined && { "content-type": "application/json" }), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const response = await handler(request, { params: Promise.resolve(options.params) });
  const text = await response.text();
  const json = JSON.parse(text) as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
  return { status: response.status, ok: json.ok, data: json.data, code: json.error?.code, message: json.error?.message, text, headers: response.headers };
}
