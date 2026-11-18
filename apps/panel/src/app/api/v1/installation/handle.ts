import { accountOfMember, isInstallationAdmin } from "@deskvoice/core";
import type { z, ZodType } from "zod";
import { ALL_ROLES, ApiError, failure, requireRole, requireSession, serverDeps, type RouteContext, type ServerDeps, type Session, type SupportOption } from "../../../../server/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InstallationArgs<B> {
  session: Session;
  /** A conta de quem pede: é ela, e não o vínculo, que administra a instalação. */
  accountId: string;
  params: Record<string, string>;
  body: B;
  url: URL;
  deps: ServerDeps;
}

/**
 * Embrulho das rotas da área da instalação (seção 3.9 do desenho do R8). Confere o papel da
 * instalação (`isInstallationAdmin`) antes de qualquer outra coisa: quem não administra recebe 403
 * em toda rota, antes de a entrada ser lida. Vale mesmo com a organização da sessão suspensa
 * (seção 3.3): quem administra precisa alcançar a área para reativá-la. Com `support: false`, a
 * sessão de suporte da instalação recebe 403 `support_session_forbidden` antes disso (seção 3.6).
 *
 * Não abre transação nenhuma. As rotas chamam só funções de `packages/core`, que abrem o papel de
 * sistema elas mesmas, ou `withOrg` na organização-alvo. O painel não abre o papel de sistema aqui.
 */
export function handleInstallation<S extends ZodType = ZodType<undefined>>(
  options: { body?: S } & SupportOption,
  fn: (args: InstallationArgs<z.output<S>>) => Promise<unknown>,
): (request: Request, context: RouteContext) => Promise<Response> {
  return async (request, context) => {
    try {
      const deps = serverDeps();
      const session = await requireSession(request, deps, { allowSuspended: true });
      if (options.support === false) requireRole(session, ALL_ROLES, { support: false });
      const accountId = await accountOfMember(deps.db, session.userId);
      if (!accountId || !(await isInstallationAdmin(deps.db, accountId))) throw new ApiError(403, "forbidden", "Only who administers the installation can do this.");
      const params = (await context.params) ?? {};
      if (params.id !== undefined && !UUID.test(params.id)) throw new ApiError(404, "not_found", "Not found.");
      const body = await parseBody(request, options.body);
      return Response.json({ ok: true, data: (await fn({ session, accountId, params, body, url: new URL(request.url), deps })) ?? null });
    } catch (error) {
      return failure(error);
    }
  };
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
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "));
  return parsed.data;
}
