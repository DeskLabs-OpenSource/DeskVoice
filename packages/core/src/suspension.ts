import type { OrgQuery } from "./types";

/**
 * A organização suspensa (seção 3.3 do desenho do R8,
 * `docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md`): enquanto
 * `suspended_at` estiver marcado, nada dela atende, liga ou roda. As linhas continuam registradas,
 * para quem liga ouvir a fala de indisponível, e não o erro da operadora.
 *
 * O código de recusa é um só em todo caminho: a chamada recusada, a saída e as rotas do painel.
 */
export const ORGANIZATION_SUSPENDED = "organization_suspended";

/**
 * A organização da transação está suspensa? Lê pela própria organização (`withOrg`), e não
 * atravessando outras. Organização que não existe mais conta como não suspensa: quem chama já
 * achou a organização por outro caminho, e a ausência dela é outro erro, de quem chama.
 */
export async function organizationSuspended(q: OrgQuery): Promise<boolean> {
  const row = await q.one<{ suspended: boolean }>("select suspended_at is not null as suspended from organizations where id = $1", [q.organizationId]);
  return row?.suspended ?? false;
}
