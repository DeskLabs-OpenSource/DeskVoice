import { randomBytes } from "node:crypto";
import { explicitAdminsTransition, lockInstallationAdmins, markInstallationAdmin, type InstallationPerson } from "./accounts";
import { ADMINS_EXPLICIT_KEY, FOUNDING_ORGANIZATION_KEY, recordInstallationEvent } from "./installation";
import { copyDefaultLimits } from "./limits";
import { defaultTimezone } from "./organization-defaults";
import { hashToken } from "./password";
import { ORG_EVENT_KINDS, type Db, type OrgEventKind, type OrgQuery } from "./types";
import { withOrg, withSystem } from "./with-org";

/**
 * As organizações vistas de cima (seção 3.3 do desenho do R8): listar, criar e renomear. Só a
 * administração da instalação chama isto; quem confere o papel é a rota, por `isInstallationAdmin`.
 *
 * A lista é a única leitura que atravessa organizações (seção 3.7). O convite do primeiro dono não
 * atravessa: é o convite de hoje, aberto em `withOrg` da organização nova.
 */

export interface OrganizationView {
  id: string;
  name: string;
  createdAt: Date;
  suspendedAt: Date | null;
  /** O motivo da suspensão, enquanto ela estiver suspensa. */
  suspendedReason: string | null;
  /** A organização de quem instalou (seção 3.2). */
  founding: boolean;
}

/** Todas as organizações da instalação: só `id`, nome, criação, estado (com o motivo da suspensão) e se é a fundadora. */
export function listOrganizations(db: Db): Promise<OrganizationView[]> {
  return withSystem(db, (q) =>
    q.many<OrganizationView>(
      `select o.id, o.name, o.created_at as "createdAt", o.suspended_at as "suspendedAt", o.suspended_reason as "suspendedReason",
              coalesce(o.id = (select (value #>> '{}')::uuid from installation_settings where key = $1), false) as founding
         from organizations o
        order by o.created_at, o.id`,
      [FOUNDING_ORGANIZATION_KEY],
    ),
  );
}

/** O que criar uma organização agora faria com a lista de quem administra (seção 3.2, item 3). */
export function previewNewOrganization(db: Db): Promise<{ explicit: boolean; granted: InstallationPerson[]; losing: InstallationPerson[] }> {
  return withSystem(db, (q) => explicitAdminsTransition(q));
}

/** Grava um evento na auditoria de uma organização, de dentro de `withSystem` (que não tem organização). */
async function recordOrgEventFor(q: OrgQuery, organizationId: string, kind: OrgEventKind, payload: object, at: Date): Promise<void> {
  if (!ORG_EVENT_KINDS.includes(kind)) throw new Error(`Unknown organization event kind: ${JSON.stringify(kind)}`);
  // Sem `actor_user_id`: quem fez é a administração da instalação, que não tem vínculo nesta organização.
  await q.exec("insert into organization_events (organization_id, at, kind, actor_user_id, payload) values ($1, $2, $3, null, $4)", [organizationId, at, kind, JSON.stringify(payload)]);
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && new Set(a).size === a.length && a.every((id) => b.includes(id));

export interface AddOrganizationInput {
  name: string;
  actorAccountId: string;
  /**
   * O que a tela mostrou antes de confirmar: quem recebe a marca e quem deixa de administrar. Se o
   * banco calcular outra lista, nada é criado (`admins_changed`): ninguém perde o papel sem ter
   * aparecido pelo nome. Ignorado quando a lista já é explícita.
   */
  shown: { granted: string[]; losing: string[] };
  /** Os administradores da fundadora que quem cria põe na lista na mesma tela. Só contas de `losing`. */
  keep: string[];
}

export type AddOrganizationResult =
  | { ok: true; organizationId: string; granted: InstallationPerson[]; kept: InstallationPerson[]; lost: InstallationPerson[] }
  | { ok: false; reason: "admins_changed" | "invalid_keep" };

/**
 * Cria uma organização, numa transação só:
 * - a organização, com a política de saída desligada, como toda organização, e com o fuso
 *   `defaults.timezone` COPIADO para `outbound_policy.timezone` (seção 3.5): sem padrão gravado, o
 *   padrão da coluna, como antes. Mudar o padrão depois não mexe nela;
 * - a linha de limites dela, com o padrão `defaults.limits` COPIADO (seção 3.5): sem padrão gravado,
 *   nenhum limite e a saída travada. Mudar o padrão depois não mexe nela;
 * - `organization_created` na auditoria da instalação e na da organização;
 * - se a lista de quem administra ainda não é explícita (é a segunda organização): a marca para todo
 *   dono ativo da fundadora que não a tem, para os administradores escolhidos em `keep`, e
 *   `installation.admins_explicit_at`, que nunca volta a ser apagado.
 *
 * Uma organização inserida por SQL direto não passa por aqui e não muda quem administra.
 */
export function addOrganization(db: Db, input: AddOrganizationInput, now: Date): Promise<AddOrganizationResult> {
  const name = input.name.trim();
  if (name === "") return Promise.reject(new Error("addOrganization: the name is empty"));
  return withSystem(db, async (q) => {
    await lockInstallationAdmins(q);
    const transition = await explicitAdminsTransition(q);
    const ids = (people: InstallationPerson[]): string[] => people.map((person) => person.accountId);
    if (!transition.explicit) {
      if (!sameSet(ids(transition.granted), input.shown.granted) || !sameSet(ids(transition.losing), input.shown.losing)) return { ok: false, reason: "admins_changed" };
      if (!input.keep.every((id) => input.shown.losing.includes(id))) return { ok: false, reason: "invalid_keep" };
    } else if (input.keep.length > 0) {
      return { ok: false, reason: "invalid_keep" };
    }

    const created = await q.one<{ id: string }>("insert into organizations (name, created_at) values ($1, $2) returning id", [name, now]);
    if (!created) throw new Error("Insert into organizations returned no row");
    const organizationId = created.id;
    const timezone = await defaultTimezone(q);
    if (timezone === null) await q.exec("insert into outbound_policy (organization_id, enabled) values ($1, false)", [organizationId]);
    else await q.exec("insert into outbound_policy (organization_id, enabled, timezone) values ($1, false, $2)", [organizationId, timezone]);
    await copyDefaultLimits(q, organizationId, now);
    await recordInstallationEvent(q, now, "organization_created", { actorAccountId: input.actorAccountId, organizationId, payload: { name } });
    await recordOrgEventFor(q, organizationId, "organization_created", { name }, now);

    if (transition.explicit) return { ok: true, organizationId, granted: [], kept: [], lost: [] };
    for (const person of transition.granted) await markInstallationAdmin(q, person.accountId, now, { actorAccountId: input.actorAccountId, source: "second_organization" });
    const kept = transition.losing.filter((person) => input.keep.includes(person.accountId));
    for (const person of kept) await markInstallationAdmin(q, person.accountId, now, { actorAccountId: input.actorAccountId, source: "second_organization_kept" });
    // Por último: se algo acima falhar, a lista continua implícita e nada ficou gravado.
    await q.exec("insert into installation_settings (key, value, updated_at) values ($1, to_jsonb($2::timestamptz), $2)", [ADMINS_EXPLICIT_KEY, now]);
    return { ok: true, organizationId, granted: transition.granted, kept, lost: transition.losing.filter((person) => !input.keep.includes(person.accountId)) };
  });
}

/**
 * Renomeia uma organização e grava `organization_renamed` nas duas auditorias. Devolve `false` se a
 * organização não existe. O mesmo nome não grava nada.
 */
export function renameOrganization(db: Db, actorAccountId: string, organizationId: string, name: string, now: Date): Promise<boolean> {
  const to = name.trim();
  if (to === "") return Promise.reject(new Error("renameOrganization: the name is empty"));
  return withSystem(db, async (q) => {
    const current = await q.one<{ name: string }>("select name from organizations where id = $1 for update", [organizationId]);
    if (!current) return false;
    if (current.name === to) return true;
    await q.exec("update organizations set name = $2 where id = $1", [organizationId, to]);
    const payload = { from: current.name, to };
    await recordInstallationEvent(q, now, "organization_renamed", { actorAccountId, organizationId, payload });
    await recordOrgEventFor(q, organizationId, "organization_renamed", payload, now);
    return true;
  });
}

/** O mesmo prazo do convite da tela Equipe. */
export const FIRST_OWNER_INVITE_DAYS = 7;

export type FirstOwnerInviteResult = { ok: true; token: string } | { ok: false; reason: "not_found" | "has_members" };

/**
 * O convite do primeiro dono de uma organização criada pela administração. É o convite de hoje, na
 * tabela `invites` e aceito pela mesma página, aberto em `withOrg` da organização: nada aqui
 * atravessa organizações, além de gravar a auditoria.
 *
 * Só para organização sem nenhum vínculo `member`: depois do primeiro dono, quem convida é ele, pela
 * tela Equipe. O e-mail pode já ter conta, inclusive o de quem convida: a pessoa aceita com a senha
 * que já tem (`acceptInvite`). Convidar de novo invalida o link anterior. O convite é marcado
 * `installation_invite` e guarda a conta de quem o gerou (`created_by_account`): ele só vale
 * enquanto a organização não tem ninguém e essa conta administra a instalação
 * (`CREATOR_STILL_MANAGES`, em `invites.ts`). Grava `first_owner_invited` na auditoria da
 * instalação, sem o token. Devolve o token em claro; o banco só recebe o hash.
 */
export async function createFirstOwnerInvite(db: Db, actorAccountId: string, organizationId: string, invite: { email: string; name: string }, now: Date): Promise<FirstOwnerInviteResult> {
  return withOrg(db, organizationId, async (q) => {
    // A trava da organização vem antes de tudo: duas chamadas ao mesmo tempo passariam juntas pela
    // revogação abaixo e deixariam dois links vivos. `no key update`, e não `update`, porque o evento
    // de auditoria (outra conexão, logo abaixo) aponta para esta organização por chave estrangeira,
    // que pede `key share` na mesma linha: com `for update` a transação esperaria por si mesma.
    if (!(await q.one("select 1 from organizations where id = $1 for no key update", [organizationId]))) return { ok: false, reason: "not_found" };
    if (await q.one("select 1 from users where kind = 'member' limit 1")) return { ok: false, reason: "has_members" };
    // Um convite do primeiro dono por vez: o novo derruba o anterior, de qualquer e-mail. Dois
    // links vivos para a organização vazia deixariam duas pessoas entrarem como "primeiro" dono.
    await q.exec("update invites set revoked_at = $2 where (email = $1 or installation_invite) and accepted_at is null and revoked_at is null", [invite.email, now]);
    const token = randomBytes(32).toString("base64url");
    const created = await q.one<{ id: string }>(
      `insert into invites (organization_id, email, name, role, token_hash, expires_at, created_by, installation_invite, created_by_account)
       values ($1, $2, $3, 'owner', $4, $5, null, true, $6) returning id`,
      [organizationId, invite.email, invite.name, hashToken(token), new Date(now.getTime() + FIRST_OWNER_INVITE_DAYS * 86_400_000), actorAccountId],
    );
    if (!created) throw new Error("createFirstOwnerInvite: the invite was not created");
    // A auditoria da instalação só se grava pelo papel de sistema, em outra conexão. Ela confirma
    // antes deste convite: se ela falhar, o convite é desfeito; o contrário (auditoria sem convite)
    // só acontece se a confirmação final falhar, e o registro a mais não dá acesso a ninguém.
    await withSystem(db, (system) =>
      recordInstallationEvent(system, now, "first_owner_invited", { actorAccountId, organizationId, payload: { invite_id: created.id, email: invite.email } }),
    );
    return { ok: true, token };
  });
}
