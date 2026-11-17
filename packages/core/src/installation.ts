import type { Db, OrgQuery } from "./types";
import { withSystem } from "./with-org";

/**
 * A camada acima das organizações (seção 3.9 do desenho do R8). Tudo aqui atravessa organizações e
 * roda pelo papel de sistema: `installation_settings` e `installation_events` não têm
 * `organization_id`, e `deskvoice_app` não tem nenhum direito sobre elas.
 */

/** Vocabulário fechado da auditoria da instalação (seção 3.8). */
export const INSTALLATION_EVENT_KINDS = [
  "installation_admin_granted",
  "installation_admin_revoked",
  "organization_created",
  "organization_renamed",
  "organization_suspended",
  "organization_reactivated",
  "organization_deleted",
  "organization_limits_changed",
  "installation_setting_changed",
  "support_access_started",
  "support_access_ended",
  "update_requested",
] as const;
export type InstallationEventKind = (typeof INSTALLATION_EVENT_KINDS)[number];

/** A organização de quem instalou. Gravada uma vez e nunca mais trocada (seção 3.2). */
export const FOUNDING_ORGANIZATION_KEY = "installation.founding_organization_id";
/** Quando a lista de quem administra ficou explícita. Nunca volta a ser apagada (seção 3.2). */
export const ADMINS_EXPLICIT_KEY = "installation.admins_explicit_at";

/** Grava um evento da instalação. `q` tem de ser de `withSystem`. */
export async function recordInstallationEvent(
  q: OrgQuery,
  at: Date,
  kind: InstallationEventKind,
  detail: { actorAccountId?: string | null; organizationId?: string | null; payload?: Record<string, unknown> } = {},
): Promise<void> {
  if (!INSTALLATION_EVENT_KINDS.includes(kind)) throw new Error(`Unknown installation event kind: ${JSON.stringify(kind)}`);
  await q.exec("insert into installation_events (at, kind, actor_account_id, organization_id, payload) values ($1, $2, $3, $4, $5)", [
    at,
    kind,
    detail.actorAccountId ?? null,
    detail.organizationId ?? null,
    detail.payload ?? {},
  ]);
}

/**
 * Grava a organização fundadora, se ainda não houver uma. Numa instalação nova a migration não acha
 * organização nenhuma, e quem a cria é `create-owner`: é ele que chama isto, na mesma transação.
 * Uma organização inserida por SQL direto não passa por aqui e não muda quem administra.
 * Devolve `true` quando gravou. `q` tem de ser de `withSystem`.
 */
export async function recordFoundingOrganization(q: OrgQuery, organizationId: string): Promise<boolean> {
  const recorded = await q.exec("insert into installation_settings (key, value) values ($1, to_jsonb($2::text)) on conflict (key) do nothing", [
    FOUNDING_ORGANIZATION_KEY,
    organizationId,
  ]);
  return recorded === 1;
}

export interface UpdateRequestView {
  id: string;
  status: string;
  fromVersion: string;
  targetVersion: string;
  toVersion: string | null;
  detail: string | null;
  outputKept: boolean;
  requestedAt: Date;
  acceptedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * O pedido de atualização mais recente da INSTALAÇÃO (seção 3.11). A linha continua sendo da
 * organização de quem pediu, mas a atualização é de todas: quem pediu de uma organização e trocou
 * para outra continua vendo o andamento. Quem chama decide quem pode ver o `detail`.
 */
export function latestUpdateRequest(db: Db): Promise<UpdateRequestView | null> {
  return withSystem(db, (q) =>
    q.one<UpdateRequestView>(
      `select id, status, from_version as "fromVersion", target_version as "targetVersion", to_version as "toVersion", detail, output_kept as "outputKept",
              requested_at as "requestedAt", accepted_at as "acceptedAt", finished_at as "finishedAt"
         from update_requests order by requested_at desc limit 1`,
    ),
  );
}
