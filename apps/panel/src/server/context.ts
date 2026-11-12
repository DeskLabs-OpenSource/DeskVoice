import { randomBytes } from "node:crypto";
import { DEFAULT_RECORDINGS_DIR, createDb, hashToken, loadConfig, systemClock, verifyPassword, withOrg, withSystem, type Clock, type Db, type OrgQuery } from "@deskvoice/core";
import { wahaFromEnv, type WahaOptions } from "@deskvoice/tools/waha";
import type { z, ZodType } from "zod";
import { trustedProxyHops } from "./client-ip";

export type Role = "owner" | "admin" | "operator";

export interface Session {
  id: string;
  userId: string;
  organizationId: string;
  role: Role;
  name: string;
  email: string;
}

export interface ServerDeps {
  db: Db;
  clock: Clock;
  secretKey: Buffer;
  publicUrl: string;
  fetch: typeof fetch;
  /** Resolvedor de nomes do envio por conector. Em teste, todo nome resolve para um endereço público. */
  lookup?: (host: string) => Promise<string[]>;
  voiceUrl: string;
  internalToken: string;
  trustedProxyHops: number;
  /** A versão deste processo (`APP_VERSION`, gravada na imagem). A tela de versão lê daqui, nunca do banco. */
  appVersion: string;
  /** Segredo do agente de atualização, gerado pelo instalador. Vazio = nenhum agente é aceito. */
  agentToken: string;
  /** Acesso ao WAHA da instalação. Chave vazia = o WhatsApp por QR Code não existe neste servidor. */
  waha: WahaOptions;
  /** Injetável para o teste contar quantas tentativas chegam a conferir a senha. */
  verifyPassword: typeof verifyPassword;
  /** Pasta das gravações (`RECORDINGS_DIR`), montada só para leitura: a tela toca e a exportação diz se há. */
  recordingsDir: string;
}

export const SESSION_COOKIE = "dv_session";
const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Em `globalThis` porque o Next carrega rotas e páginas em instâncias separadas do módulo, e o
// modo de desenvolvimento recarrega o arquivo a cada edição: sem isso, cada uma abriria um pool.
const store = globalThis as { __deskvoicePanelDeps?: ServerDeps };

/** Dependências do processo, criadas na primeira requisição (o build do Next importa as rotas sem ambiente). */
export function serverDeps(): ServerDeps {
  if (!store.__deskvoicePanelDeps) {
    const config = loadConfig(process.env);
    store.__deskvoicePanelDeps = {
      db: createDb(config.databaseUrl, config.systemDatabaseUrl),
      clock: systemClock,
      secretKey: config.secretKey,
      publicUrl: config.publicUrl,
      fetch: (input, init) => fetch(input, init),
      voiceUrl: process.env.VOICE_INTERNAL_URL ?? "http://voice:8090",
      internalToken: process.env.INTERNAL_TOKEN ?? "",
      trustedProxyHops: trustedProxyHops(process.env),
      appVersion: process.env.APP_VERSION ?? "dev",
      agentToken: process.env.UPDATE_AGENT_TOKEN ?? "",
      waha: wahaFromEnv(),
      verifyPassword,
      recordingsDir: process.env.RECORDINGS_DIR ?? DEFAULT_RECORDINGS_DIR,
    };
  }
  return store.__deskvoicePanelDeps;
}

/** Só para testes: troca banco, relógio e `fetch` do processo. */
export function setServerDeps(deps: ServerDeps | undefined): void {
  store.__deskvoicePanelDeps = deps;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Resposta de sucesso que também precisa mandar cabeçalhos (o cookie de sessão). */
export class Reply {
  constructor(
    readonly data: unknown,
    readonly headers: Record<string, string>,
  ) {}
}

function success(result: unknown): Response {
  if (result instanceof Reply) return Response.json({ ok: true, data: result.data }, { headers: result.headers });
  return Response.json({ ok: true, data: result ?? null });
}

export function failure(error: unknown): Response {
  const send = (status: number, code: string, message: string): Response => Response.json({ ok: false, error: { code, message } }, { status });
  if (error instanceof ApiError) return send(error.status, error.code, error.message);
  const pgCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (pgCode === "23505") return send(409, "already_exists", "A record with these values already exists.");
  // Chave estrangeira composta com a organização: apontar para linha de outra organização cai aqui.
  if (pgCode === "23503") return send(404, "not_found", "A referenced record was not found.");
  process.stderr.write(`[panel] unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  return send(500, "internal_error", "Unexpected server error.");
}

async function parseBody<S extends ZodType>(request: Request, schema: S | undefined): Promise<z.output<S>> {
  if (!schema) return undefined as z.output<S>;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
  const parsed = await schema.safeParseAsync(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    throw new ApiError(400, "validation_error", problems.join("; "));
  }
  return parsed.data;
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function sessionCookie(token: string, deps: ServerDeps): string {
  const secure = deps.publicUrl.startsWith("https:") ? "; Secure" : "";
  const maxAge = token === "" ? 0 : SESSION_SECONDS;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Cria a sessão e devolve o token em claro; o banco só recebe o hash. */
export async function createSession(q: OrgQuery, user: { id: string; organizationId: string }, now: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await q.exec("insert into sessions (organization_id, user_id, token_hash, expires_at) values ($1, $2, $3, $4)", [
    user.organizationId,
    user.id,
    hashToken(token),
    new Date(now.getTime() + SESSION_SECONDS * 1000),
  ]);
  return token;
}

/**
 * A sessão é achada pelo hash do token antes de se saber a organização: por isso `withSystem`.
 * Conferida no banco a cada requisição: sessão de pessoa desativada deixa de valer na hora.
 */
export async function findSession(deps: ServerDeps, token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  return withSystem(deps.db, (q) =>
    q.one<Session>(
      `select s.id, s.user_id as "userId", s.organization_id as "organizationId", u.role, u.name, u.email
         from sessions s join users u on u.id = s.user_id and u.organization_id = s.organization_id
        where s.token_hash = $1 and s.expires_at > $2 and u.disabled_at is null`,
      [hashToken(token), deps.clock.now()],
    ),
  );
}

export async function requireSession(request: Request, deps: ServerDeps = serverDeps()): Promise<Session> {
  const session = await findSession(deps, readCookie(request, SESSION_COOKIE));
  if (!session) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  return session;
}

export const CONFIG_ROLES: readonly Role[] = ["owner", "admin"];

/** Único lugar que decide o que cada papel pode. Sem `allowed`, exige quem altera configuração. */
export function requireRole(session: Session, allowed: readonly Role[] = CONFIG_ROLES): void {
  if (!allowed.includes(session.role)) throw new ApiError(403, "forbidden", "Your role cannot change this. Ask an owner or admin.");
}

export interface RouteContext {
  // O Next entrega `undefined` para rota sem segmento dinâmico.
  params: Promise<Record<string, string> | undefined>;
}

interface Base<B> {
  session: Session;
  params: Record<string, string>;
  body: B;
  url: URL;
  deps: ServerDeps;
}
export interface HandlerArgs<B> extends Base<B> {
  q: OrgQuery;
}
export interface AfterArgs<B> extends Base<B> {
  /** Nova transação na organização da sessão, para gravar o que veio de fora. */
  org<T>(fn: (q: OrgQuery) => Promise<T>): Promise<T>;
}

interface HandleOptions<S extends ZodType, R> {
  body?: S;
  /** Rota que altera configuração: só `owner` e `admin`. */
  configure?: boolean;
  /**
   * Roda antes de abrir a transação, já com a sessão, o papel e a entrada conferidos. É onde cabe
   * uma consulta de rede de que a rota depende: destino lento não segura conexão do banco.
   */
  before?: (args: Base<z.output<S>>) => Promise<void>;
  /**
   * Roda depois que a transação confirmou, fora dela. É onde se fala com o processo de voz: ele
   * lê o banco, então só enxerga o que já foi confirmado. O que devolver vira a resposta.
   */
  after?: (result: R, args: AfterArgs<z.output<S>>) => Promise<unknown>;
}

/** Embrulha uma rota autenticada: sessão, papel, entrada validada, `withOrg` e envelope de resposta. */
export function handle<S extends ZodType = ZodType<undefined>, R = unknown>(
  options: HandleOptions<S, R>,
  fn: (args: HandlerArgs<z.output<S>>) => Promise<R>,
): (request: Request, context: RouteContext) => Promise<Response> {
  return async (request, context) => {
    try {
      const deps = serverDeps();
      const session = await requireSession(request, deps);
      if (options.configure) requireRole(session);
      const params = (await context.params) ?? {};
      // Id malformado nunca chega ao banco: para quem chama, é só um registro que não existe.
      if (params.id !== undefined && !UUID.test(params.id)) throw new ApiError(404, "not_found", "Not found.");
      const base: Base<z.output<S>> = { session, params, body: await parseBody(request, options.body), url: new URL(request.url), deps };
      if (options.before) await options.before(base);
      const org = <T>(run: (q: OrgQuery) => Promise<T>): Promise<T> => withOrg(deps.db, session.organizationId, run);
      const result = await org((q) => fn({ ...base, q }));
      return success(options.after ? await options.after(result, { ...base, org }) : result);
    } catch (error) {
      return failure(error);
    }
  };
}

/** Rota pública (login, saúde): mesma validação e mesmo envelope, sem sessão. */
export function handlePublic<S extends ZodType = ZodType<undefined>>(
  options: { body?: S },
  fn: (args: { request: Request; body: z.output<S>; deps: ServerDeps; params: Record<string, string> }) => Promise<unknown>,
): (request: Request, context?: RouteContext) => Promise<Response> {
  return async (request, context) => {
    try {
      const params = (await context?.params) ?? {};
      return success(await fn({ request, body: await parseBody(request, options.body), deps: serverDeps(), params }));
    } catch (error) {
      return failure(error);
    }
  };
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "Not found.");
}
