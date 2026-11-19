import { rm } from "node:fs/promises";
import path from "node:path";
import { wakeTaskRunner } from "./queue";
import type { Clock, Db, OrgQuery } from "./types";
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
  "first_owner_invited",
  "organization_suspended",
  "organization_reactivated",
  "organization_deletion_started",
  "organization_deleted",
  "organization_limits_changed",
  "installation_setting_changed",
  "support_access_started",
  "support_access_ended",
  "update_requested",
  "trunk_overlap_refused",
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

/** O motivo da suspensão e da exclusão, em caracteres, depois de tirar os espaços das pontas (seção 3.3). */
export const SUSPENSION_REASON_MIN = 10;
export const SUSPENSION_REASON_MAX = 500;

/**
 * Uma mudança de estado de organização por vez na instalação (suspender e pedir a exclusão): duas ao
 * mesmo tempo, em organizações diferentes, leriam cada uma a outra como ativa e deixariam a
 * instalação sem nenhuma. A trava é da transação e cai no fim dela, já confirmada. O nome da trava
 * continua o da suspensão, que a criou: trocar o texto trocaria a trava.
 */
export const ORGANIZATION_STATE_LOCK_SQL = "select pg_advisory_xact_lock(hashtextextended('deskvoice:organization_suspension', 0))";

export type RequestOrganizationDeletionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "not_suspended" | "already_deleting" | "name_mismatch" | "invalid_reason" | "last_organization" | "update_request_open";
    };

/**
 * Pede a exclusão de uma organização (seção 3.3 e "Fatia 9" do desenho do R8): grava a lápide
 * (`deleting_at`, `deleting_reason`, `deleting_by`) e `organization_deletion_started` na auditoria da
 * instalação, numa transação só, com a mesma trava da suspensão. Daí em diante a organização não
 * volta: reativar é recusado, e a rotina (`apps/routines`) termina a exclusão com
 * `executeOrganizationDeletion`. A transação acorda a rotina quando confirma.
 *
 * Recusa, sem gravar nada: a organização que não existe, a que não está suspensa, a que já tem
 * lápide, o nome digitado diferente do gravado (depois de `trim`, com diferença entre maiúscula e
 * minúscula), o motivo fora de 10 a 500 caracteres, a última organização sem lápide da instalação e
 * a organização com pedido de atualização `requested` ou `running` (seção 3.11). Quem confere o papel
 * da instalação é a rota.
 */
export function requestOrganizationDeletion(
  db: Db,
  input: { organizationId: string; typedName: string; reason: string; accountId: string; now: Date },
): Promise<RequestOrganizationDeletionResult> {
  return withSystem(db, async (q): Promise<RequestOrganizationDeletionResult> => {
    await q.exec(ORGANIZATION_STATE_LOCK_SQL);
    const current = await q.one<{ name: string; suspended: boolean; deleting: boolean }>(
      "select name, suspended_at is not null as suspended, deleting_at is not null as deleting from organizations where id = $1 for update",
      [input.organizationId],
    );
    if (!current) return { ok: false, reason: "not_found" };
    if (current.deleting) return { ok: false, reason: "already_deleting" };
    if (!current.suspended) return { ok: false, reason: "not_suspended" };
    if (input.typedName.trim() !== current.name.trim()) return { ok: false, reason: "name_mismatch" };
    const reason = input.reason.trim();
    if (reason.length < SUSPENSION_REASON_MIN || reason.length > SUSPENSION_REASON_MAX) return { ok: false, reason: "invalid_reason" };
    const others = await q.one<{ n: number }>("select count(*)::int as n from organizations where deleting_at is null and id <> $1", [input.organizationId]);
    if (!others || others.n === 0) return { ok: false, reason: "last_organization" };
    if (await q.one("select 1 from update_requests where organization_id = $1 and status in ('requested', 'running') limit 1", [input.organizationId])) {
      return { ok: false, reason: "update_request_open" };
    }

    await q.exec("update organizations set deleting_at = $2, deleting_reason = $3, deleting_by = $4 where id = $1", [
      input.organizationId,
      input.now,
      reason,
      input.accountId,
    ]);
    await recordInstallationEvent(q, input.now, "organization_deletion_started", {
      actorAccountId: input.accountId,
      organizationId: input.organizationId,
      payload: { name: current.name, reason },
    });
    await wakeTaskRunner(q);
    return { ok: true };
  });
}

/** O que `executeOrganizationDeletion` precisa de fora do banco. */
export interface OrganizationDeletionDeps {
  db: Db;
  clock: Clock;
  /** A pasta das gravações: a da organização (`<recordingsDir>/<id>`) é apagada inteira. */
  recordingsDir: string;
  /**
   * Desfaz a sessão do WhatsApp da organização no WAHA (`logout`, depois `stop` e `delete`). Sessão
   * que não existe conta como feito; lançar é "tentar de novo", e o banco não é apagado. O WAHA fora
   * do ar conta como feito quando nenhuma organização quer o serviço (`endWhatsAppSessionUnlessUnused`).
   */
  endWhatsAppSession(organizationId: string): Promise<void>;
  /** Só para o teste interromper a execução depois de um passo, como faria um reinício. */
  afterStep?: (step: OrganizationDeletionStep) => Promise<void> | void;
}

/**
 * Alguma organização da instalação quer o serviço do WhatsApp (`whatsapp_sessions.service_wanted`),
 * a que tem lápide inclusive. Só um sim ou não, pelo papel de sistema.
 */
export async function whatsappServiceWanted(db: Db): Promise<boolean> {
  return withSystem(db, async (q) => (await q.one("select 1 as wanted from whatsapp_sessions where service_wanted limit 1")) !== null);
}

/**
 * O passo 2 da exclusão com o WAHA que não está de pé (ajuste 1 da 9b). O WAHA fica no perfil
 * `whatsapp` do compose e não sobe por padrão, e o instalador gera a chave sempre: sem isto, a
 * instalação sem WhatsApp ficaria com a lápide para sempre.
 *
 * `end` desfaz a sessão; `isUnreachable` diz se a falha foi o WAHA não responder (fora do ar ou sem
 * resposta a tempo). Essa falha conta como feito quando nenhuma organização quer o serviço: assim o
 * agente do kit não sobe o WAHA, desligar o serviço exige desconectar antes (o logout acontece aí), e
 * o WAHA só retoma sessão que estava rodando. Com alguma organização querendo, ou com qualquer outra
 * falha (chave recusada, erro do WAHA), lança, e a exclusão tenta de novo.
 */
export async function endWhatsAppSessionUnlessUnused(db: Db, end: () => Promise<void>, isUnreachable: (error: unknown) => boolean): Promise<void> {
  try {
    await end();
  } catch (error) {
    if (isUnreachable(error) && !(await whatsappServiceWanted(db))) return;
    throw error;
  }
}

/** Os passos com efeito, na ordem: 2 é o WAHA, 3 as gravações, 4 o `delete`, 5 as contas. */
export type OrganizationDeletionStep = 2 | 3 | 4 | 5;

export type ExecuteOrganizationDeletionResult =
  /** A organização foi apagada agora. */
  | { status: "deleted"; counts: Record<string, number>; deletedAccounts: number }
  /** Um passo de fora do banco falhou: nada do banco foi apagado, e a rotina tenta de novo. */
  | { status: "retry"; step: "whatsapp" | "recordings"; error: string }
  /** A organização não tem lápide, ou já foi apagada: não há o que fazer, e nada foi tocado. */
  | { status: "nothing_to_do" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

// As tabelas que a cascata da 9a apaga: as que têm `organization_id` com chave `on delete cascade`
// para `organizations (id)`. Vem do catálogo, como no teste da 9a: a tabela que nascer depois entra
// na contagem sem ninguém lembrar. `installation_events` fica de fora (é `on delete set null`).
const CASCADED_TABLES_SQL = `
  select c.conrelid::regclass::text as name
    from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'public.organizations'::regclass and c.confdeltype = 'c'
     and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'organization_id' and not a.attisdropped)]
   order by 1`;

/**
 * Termina a exclusão de uma organização com lápide (seção 3.3 e "Fatia 9" do desenho do R8). É
 * idempotente, e cada passo pode ser repetido depois de um reinício:
 *
 * 2. a sessão do WhatsApp (`deps.endWhatsAppSession`). Com o WAHA fora do ar, para aqui e devolve
 *    `retry`, sem apagar o banco: uma sessão viva sem dona deixaria o aparelho em "Dispositivos
 *    conectados";
 * 3. a pasta das gravações (`<recordingsDir>/<id>`), inteira. Pasta que não existe conta como feito;
 * 4. `delete from organizations ... and deleting_at is not null`, pelo papel de sistema, e a cascata
 *    da 9a apaga o resto;
 * 5. as contas que ficaram sem vínculo nenhum e sem a marca da instalação, só entre as que tinham
 *    vínculo com a organização;
 * 6. `organization_deleted` na auditoria da instalação, com o nome, o motivo, as contagens e quantas
 *    contas saíram (sem e-mail).
 *
 * As contagens e a lista das contas (o passo 1 do desenho) são lidas na mesma transação dos passos 4
 * a 6, logo antes do `delete`: essa transação confirma tudo ou nada, então um reinício nunca deixa a
 * organização apagada sem as contas apagadas ou sem o registro, e o registro sai uma vez só.
 *
 * Antes de qualquer passo, confere que a organização ainda tem lápide: a organização ativa nunca
 * perde a sessão do WhatsApp nem as gravações por aqui.
 */
export async function executeOrganizationDeletion(deps: OrganizationDeletionDeps, organizationId: string): Promise<ExecuteOrganizationDeletionResult> {
  if (!UUID.test(organizationId)) throw new Error(`executeOrganizationDeletion: invalid organization id ${JSON.stringify(organizationId)}`);
  const pending = await withSystem(deps.db, (q) => q.one("select 1 from organizations where id = $1 and deleting_at is not null", [organizationId]));
  if (!pending) return { status: "nothing_to_do" };

  try {
    await deps.endWhatsAppSession(organizationId);
  } catch (error) {
    return { status: "retry", step: "whatsapp", error: error instanceof Error ? error.message : String(error) };
  }
  await deps.afterStep?.(2);

  try {
    await rm(path.join(deps.recordingsDir, organizationId), { recursive: true, force: true });
  } catch (error) {
    return { status: "retry", step: "recordings", error: error instanceof Error ? error.message : String(error) };
  }
  await deps.afterStep?.(3);

  return withSystem(deps.db, async (q): Promise<ExecuteOrganizationDeletionResult> => {
    // Sem filtrar a lápide aqui: quem decide é o `delete` logo abaixo, que é a guarda de verdade.
    const org = await q.one<{ name: string; reason: string | null; by: string | null; at: Date | null }>(
      "select name, deleting_reason as reason, deleting_by as by, deleting_at as at from organizations where id = $1 for update",
      [organizationId],
    );
    // Outro processo terminou a exclusão enquanto este falava com o WAHA.
    if (!org) return { status: "nothing_to_do" };

    // Passo 1: as contagens, por tabela da cascata, e as contas com vínculo aqui.
    const tables = await q.many<{ name: string }>(CASCADED_TABLES_SQL);
    const counts: Record<string, number> = {};
    for (const { name } of tables) {
      const row = await q.one<{ n: number }>(`select count(*)::int as n from ${quoteIdent(name)} where organization_id = $1`, [organizationId]);
      counts[name] = row?.n ?? 0;
    }
    const linked = (await q.many<{ id: string }>("select distinct account_id as id from users where organization_id = $1 and account_id is not null", [organizationId])).map(
      (row) => row.id,
    );

    // A organização sem lápide nunca é apagada, nem se a lápide sumir (por SQL) depois da conferência
    // do começo: as contagens lidas acima não gravaram nada, e a transação termina sem mudança.
    const deleted = await q.exec("delete from organizations where id = $1 and deleting_at is not null", [organizationId]);
    if (deleted !== 1) return { status: "nothing_to_do" };
    await deps.afterStep?.(4);

    const accounts = await q.exec(
      `delete from accounts a
        where a.id = any($1::uuid[]) and a.installation_admin_at is null
          and not exists (select from users u where u.account_id = a.id)`,
      [linked],
    );
    await deps.afterStep?.(5);

    const now = deps.clock.now();
    await recordInstallationEvent(q, now, "organization_deleted", {
      actorAccountId: org.by,
      // Nulo: a organização acabou de sair, e a chave é `on delete set null` (fatia 9a). O id vai no payload.
      organizationId: null,
      payload: { organization_id: organizationId, name: org.name, reason: org.reason, requested_at: org.at, counts, deleted_accounts: accounts },
    });
    return { status: "deleted", counts, deletedAccounts: accounts };
  });
}
