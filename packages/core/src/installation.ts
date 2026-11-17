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

/** Se a lista de quem administra a instalação já é explícita (seção 3.2). Estado gravado, nunca contagem. */
export function adminsExplicit(db: Db): Promise<boolean> {
  return withSystem(db, async (q) => (await q.one("select 1 from installation_settings where key = $1", [ADMINS_EXPLICIT_KEY])) !== null);
}

/**
 * Grava o pedido de atualização e `update_requested` na auditoria da instalação, na mesma
 * transação (seção 3.11). A linha continua sendo da organização de quem pediu, e `requested_by`
 * aponta para o vínculo dessa pessoa ali; a auditoria guarda a organização e a CONTA. Quem chama já
 * conferiu o papel e a senha. Lança com o código `23505` se já existe pedido aberto na instalação.
 */
export function requestInstallationUpdate(
  db: Db,
  request: { organizationId: string; userId: string; fromVersion: string; targetVersion: string },
  now: Date,
): Promise<UpdateRequestView> {
  return withSystem(db, async (q) => {
    const row = await q.one<UpdateRequestView & { accountId: string }>(
      `insert into update_requests (organization_id, requested_by, from_version, target_version, requested_at)
       select u.organization_id, u.id, $3, $4, $5 from users u where u.id = $2 and u.organization_id = $1 and u.kind = 'member'
       returning id, status, from_version as "fromVersion", target_version as "targetVersion", to_version as "toVersion", detail, output_kept as "outputKept",
                 requested_at as "requestedAt", accepted_at as "acceptedAt", finished_at as "finishedAt",
                 (select account_id from users where id = $2) as "accountId"`,
      [request.organizationId, request.userId, request.fromVersion, request.targetVersion, now],
    );
    if (!row) throw new Error("requestInstallationUpdate: the user is not a member of this organization");
    const { accountId, ...view } = row;
    await recordInstallationEvent(q, now, "update_requested", {
      actorAccountId: accountId,
      organizationId: request.organizationId,
      payload: { request_id: view.id, from_version: request.fromVersion, target_version: request.targetVersion },
    });
    return view;
  });
}

export interface InstallationEventView {
  id: string;
  at: Date;
  kind: InstallationEventKind;
  /** O e-mail da conta que fez, ou `null` (a migration, um comando de dentro da VPS ou a conta que já não existe). */
  actorEmail: string | null;
  organizationId: string | null;
  /** O nome de agora da organização, ou `null` se ela não existe mais. */
  organizationName: string | null;
  /** O e-mail da conta que recebeu ou perdeu a marca (`payload.account_id`), se ela ainda existe. */
  subjectEmail: string | null;
  payload: Record<string, unknown>;
}

export const INSTALLATION_EVENTS_PAGE = 100;

/** A auditoria da instalação, da mais nova para a mais antiga, em páginas. `before` é o id do último já mostrado. */
export function listInstallationEvents(db: Db, before?: string): Promise<InstallationEventView[]> {
  return withSystem(db, (q) =>
    q.many<InstallationEventView>(
      `select e.id::text as id, e.at, e.kind, a.email::text as "actorEmail", e.organization_id as "organizationId", o.name as "organizationName",
              t.email::text as "subjectEmail", e.payload
         from installation_events e
         left join accounts a on a.id = e.actor_account_id
         left join accounts t on t.id::text = e.payload->>'account_id'
         left join organizations o on o.id = e.organization_id
        where ($1::bigint is null or e.id < $1::bigint)
        order by e.id desc
        limit $2`,
      [before ?? null, INSTALLATION_EVENTS_PAGE],
    ),
  );
}
