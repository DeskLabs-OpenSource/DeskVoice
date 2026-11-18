import { administersInstallationSql, openSupportAccessesOf } from "./accounts";
import { recordInstallationEvent } from "./installation";
import { ORG_EVENT_KINDS, type Db, type OrgEventKind, type OrgQuery } from "./types";
import { withOrg, withSystem } from "./with-org";

/**
 * O acesso de suporte da instalação (seção 3.6 do desenho do R8,
 * `docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md`): quem administra a
 * instalação entra numa organização com motivo e prazo, por um vínculo `users.kind = 'support'`.
 *
 * Este é o único arquivo que grava `kind = 'support'`. O vínculo:
 * - tem papel `admin`, nunca `owner`;
 * - nasce sem telefone e sem WhatsApp, e a reativação apaga os dois de novo;
 * - fica com `disabled_at` sempre que não há acesso vivo.
 *
 * O acesso acaba por três caminhos, e nenhum depende do outro: o encerrar (`endSupportAccess` com
 * `ended`), a primeira requisição depois do prazo (`findSession` do painel, com `expired`) e a
 * tarefa `end_support_access`, enfileirada para a hora do prazo. Rodar o fim de novo não grava nada.
 *
 * Acaba também, com `revoked`, quando a conta deixa de cumprir `supportAllowedSql`: deixa de
 * administrar a instalação ou perde o último vínculo `member` ativo. Na hora, onde isso acontece
 * pelo painel (`endSupportAccessesIfNotAllowed`), e na próxima requisição da sessão (`findSession`),
 * que cobre qualquer outro caminho.
 */

/** Os prazos aceitos, em minutos. Não se renova: acabou, começa outro, com motivo novo. */
export const SUPPORT_ACCESS_MINUTES = [15, 30, 60] as const;
export type SupportAccessMinutes = (typeof SUPPORT_ACCESS_MINUTES)[number];

/** O motivo, em caracteres, depois de tirar os espaços das pontas. */
export const SUPPORT_REASON_MIN = 10;
export const SUPPORT_REASON_MAX = 500;

/** O tipo da tarefa que encerra o acesso na hora do prazo. */
export const END_SUPPORT_ACCESS_TASK = "end_support_access";

export type SupportAccessEndCause = "ended" | "expired" | "revoked";

/**
 * A regra de quem pode estar numa sessão de suporte, em SQL, numa fonte só: a conta administra a
 * instalação (`administersInstallationSql`) e tem pelo menos um vínculo `member` ativo, para onde a
 * sessão volta. `account` é uma expressão SQL do código (um parâmetro ou uma coluna da consulta de
 * fora), nunca texto de fora. Ela é lida uma vez, num alias próprio: os nomes das consultas de
 * dentro não a escondem. Pelo papel de sistema.
 */
export function supportAllowedSql(account: string): string {
  return `(select ${administersInstallationSql("support_rule.account_id")}
            and exists (select from users support_home
                         where support_home.account_id = support_rule.account_id and support_home.kind = 'member' and support_home.disabled_at is null)
     from (select ${account} as account_id) support_rule)`;
}

export interface StartSupportAccessInput {
  /** A conta de quem pede. É ela, e não o vínculo, que administra a instalação. */
  actorAccountId: string;
  /** A sessão de quem pede, num vínculo `member`: é ela que passa para a organização. */
  sessionId: string;
  organizationId: string;
  reason: string;
  minutes: number;
}

export type StartSupportAccessResult =
  | { ok: true; supportAccessId: string; userId: string; expiresAt: Date }
  | {
      ok: false;
      reason: "not_installation_admin" | "invalid_minutes" | "invalid_reason" | "not_found" | "already_member" | "session_not_found" | "support_access_active";
    };

const isMinutes = (minutes: number): minutes is SupportAccessMinutes => (SUPPORT_ACCESS_MINUTES as readonly number[]).includes(minutes);

/** Grava um evento na auditoria de uma organização, de dentro de `withSystem` (que não tem organização). */
async function recordOrgEventIn(q: OrgQuery, organizationId: string, kind: OrgEventKind, payload: object, at: Date, actorUserId: string | null): Promise<void> {
  if (!ORG_EVENT_KINDS.includes(kind)) throw new Error(`Unknown organization event kind: ${JSON.stringify(kind)}`);
  await q.exec("insert into organization_events (organization_id, at, kind, actor_user_id, payload) values ($1, $2, $3, $4, $5)", [
    organizationId,
    at,
    kind,
    actorUserId,
    JSON.stringify(payload),
  ]);
}

/**
 * Começa um acesso de suporte, numa transação só, pelo papel de sistema (a conta e a sessão
 * atravessam organizações):
 * - confere que a conta administra a instalação, o prazo (15, 30 ou 60) e o motivo (10 a 500);
 * - aceita a organização suspensa: o suporte serve justamente para isso;
 * - recusa com `already_member` a organização em que a conta já tem vínculo `member`, ativo ou não.
 *   Quem é da equipe entra pelo seletor, e o vínculo `member` fica como está;
 * - cria o vínculo `support`, ou reativa o que já existe, com papel `admin`, o nome do vínculo de
 *   quem pede, e sem telefone e sem WhatsApp;
 * - grava a linha de `support_accesses` e leva a sessão para lá, com `support_access_id`. Não grava
 *   `last_organization_id`: o próximo login nunca cai na organização do suporte;
 * - grava `support_access_started` na auditoria da organização e na da instalação, com o motivo e
 *   o prazo;
 * - enfileira `end_support_access` para a hora do prazo.
 *
 * Um acesso vivo do mesmo vínculo (de outra sessão da mesma conta) recusa com
 * `support_access_active`; o que já passou do prazo e ainda não foi encerrado é encerrado aqui.
 */
export async function startSupportAccess(db: Db, input: StartSupportAccessInput, now: Date): Promise<StartSupportAccessResult> {
  if (!isMinutes(input.minutes)) return { ok: false, reason: "invalid_minutes" };
  const reason = input.reason.trim();
  if (reason.length < SUPPORT_REASON_MIN || reason.length > SUPPORT_REASON_MAX) return { ok: false, reason: "invalid_reason" };
  const minutes = input.minutes;
  return withSystem(db, async (q): Promise<StartSupportAccessResult> => {
    const admin = await q.one<{ administers: boolean }>(`select ${administersInstallationSql("$1")} as administers`, [input.actorAccountId]);
    if (admin?.administers !== true) return { ok: false, reason: "not_installation_admin" };

    // A sessão de quem pede: da conta, num vínculo `member` ativo e fora de um acesso de suporte.
    const session = await q.one<{ name: string }>(
      `select u.name from sessions s join users u on u.id = s.user_id and u.organization_id = s.organization_id
        where s.id = $1 and s.account_id = $2 and s.expires_at > $3 and s.support_access_id is null and u.kind = 'member' and u.disabled_at is null
        for update of s`,
      [input.sessionId, input.actorAccountId, now],
    );
    if (!session) return { ok: false, reason: "session_not_found" };

    const organization = await q.one("select 1 from organizations where id = $1 for key share", [input.organizationId]);
    if (!organization) return { ok: false, reason: "not_found" };

    // Um vínculo por conta e organização (`users_one_membership_idx`): o `member` recusa, o
    // `support` é reativado. Trava a linha, para dois pedidos ao mesmo tempo não reativarem juntos.
    const existing = await q.one<{ id: string; kind: "member" | "support" }>(
      "select id, kind from users where organization_id = $1 and account_id = $2 for update",
      [input.organizationId, input.actorAccountId],
    );
    if (existing?.kind === "member") return { ok: false, reason: "already_member" };

    let userId: string;
    if (existing) {
      userId = existing.id;
      const open = await q.many<{ id: string; expired: boolean }>(
        "select id, expires_at <= $3 as expired from support_accesses where organization_id = $1 and user_id = $2 and ended_at is null",
        [input.organizationId, userId, now],
      );
      if (open.some((access) => !access.expired)) return { ok: false, reason: "support_access_active" };
      for (const access of open) await endInTransaction(q, access.id, now, "expired");
      // Reativa sem copiar nada da conta: telefone e WhatsApp voltam a ser nulos, o papel é `admin`.
      await q.exec("update users set role = 'admin', name = $3, phone_e164 = null, whatsapp_e164 = null, disabled_at = null where id = $1 and organization_id = $2 and kind = 'support'", [
        userId,
        input.organizationId,
        session.name,
      ]);
    } else {
      // O e-mail é a cópia do da conta, como em todo vínculo (a coluna não aceita nulo); o resto da
      // conta não vem.
      const created = await q.one<{ id: string }>(
        `insert into users (organization_id, account_id, kind, email, name, role, phone_e164, whatsapp_e164)
         select $1, a.id, 'support', a.email, $3, 'admin', null, null from accounts a where a.id = $2 returning id`,
        [input.organizationId, input.actorAccountId, session.name],
      );
      if (!created) return { ok: false, reason: "not_installation_admin" };
      userId = created.id;
    }

    const expiresAt = new Date(now.getTime() + minutes * 60_000);
    const access = await q.one<{ id: string }>(
      "insert into support_accesses (organization_id, user_id, reason, started_at, expires_at) values ($1, $2, $3, $4, $5) returning id",
      [input.organizationId, userId, reason, now, expiresAt],
    );
    if (!access) throw new Error("startSupportAccess: the access was not recorded");

    // Só a sessão de quem pede. `last_organization_id` fica como estava.
    const moved = await q.exec("update sessions set organization_id = $2, user_id = $3, support_access_id = $4 where id = $1", [input.sessionId, input.organizationId, userId, access.id]);
    if (moved !== 1) throw new Error("startSupportAccess: the session did not move");

    const detail = { support_access_id: access.id, reason, minutes, expires_at: expiresAt.toISOString() };
    await recordOrgEventIn(q, input.organizationId, "support_access_started", detail, now, userId);
    await recordInstallationEvent(q, now, "support_access_started", { actorAccountId: input.actorAccountId, organizationId: input.organizationId, payload: detail });

    // No molde de `expire_approval`: a tarefa nasce com o acesso e roda na hora do prazo.
    await q.exec("insert into tasks (organization_id, kind, payload, run_at) values ($1, $2, $3, $4)", [
      input.organizationId,
      END_SUPPORT_ACCESS_TASK,
      JSON.stringify({ supportAccessId: access.id }),
      expiresAt,
    ]);
    return { ok: true, supportAccessId: access.id, userId, expiresAt };
  });
}

/**
 * Encerra um acesso de suporte, numa transação só. Devolve `false`, sem gravar nada, se ele já
 * acabou, se não existe, ou se a causa é `expired` e o prazo ainda não passou. Com `revoked`,
 * `actorAccountId` é quem tirou a administração (nulo quando quem nota é a sessão).
 */
export function endSupportAccess(db: Db, supportAccessId: string, now: Date, cause: SupportAccessEndCause, actorAccountId: string | null = null): Promise<boolean> {
  return withSystem(db, (q) => endInTransaction(q, supportAccessId, now, cause, actorAccountId));
}

/**
 * Sair: apaga a sessão do token, em qualquer estado (vencida, de pessoa desativada, de suporte já
 * encerrado), numa transação só. Se ela está num acesso de suporte ainda aberto, encerra o acesso
 * antes: `expired` se o prazo passou, `ended` se não. Token desconhecido não faz nada.
 */
export function signOut(db: Db, tokenHash: string, now: Date): Promise<void> {
  return withSystem(db, async (q) => {
    const session = await q.one<{ supportAccessId: string | null; expired: boolean }>(
      `select sa.id as "supportAccessId", coalesce(sa.expires_at <= $2, false) as expired
         from sessions s
         left join support_accesses sa on sa.organization_id = s.organization_id and sa.id = s.support_access_id and sa.ended_at is null
        where s.token_hash = $1
        for update of s`,
      [tokenHash, now],
    );
    if (session?.supportAccessId) await endInTransaction(q, session.supportAccessId, now, session.expired ? "expired" : "ended");
    await q.exec("delete from sessions where token_hash = $1", [tokenHash]);
  });
}

/**
 * Encerra com `revoked` todo acesso aberto dos vínculos de suporte da conta, se ela não cumpre mais
 * `supportAllowedSql`. Quem tira a administração ou desativa um vínculo chama isto logo depois;
 * `actorAccountId` é quem fez. Devolve quantos acessos encerrou. `endSupportAccessesIfNotAllowedIn`
 * roda na transação de quem chama, pelo papel de sistema.
 */
export function endSupportAccessesIfNotAllowed(db: Db, accountId: string, now: Date, actorAccountId: string | null): Promise<number> {
  return withSystem(db, (q) => endSupportAccessesIfNotAllowedIn(q, accountId, now, actorAccountId));
}

export async function endSupportAccessesIfNotAllowedIn(q: OrgQuery, accountId: string, now: Date, actorAccountId: string | null): Promise<number> {
  const rule = await q.one<{ allowed: boolean }>(`select ${supportAllowedSql("$1::uuid")} as allowed`, [accountId]);
  if (rule?.allowed === true) return 0;
  let ended = 0;
  for (const id of await openSupportAccessesOf(q, accountId)) if (await endInTransaction(q, id, now, "revoked", actorAccountId)) ended += 1;
  return ended;
}

/**
 * O fim do acesso, na transação de quem chama (pelo papel de sistema):
 * - grava `ended_at`: `now` quando a pessoa encerra ou a administração acaba (nunca depois do
 *   prazo), e `expires_at` quando o prazo vence;
 * - põe `disabled_at` no vínculo de suporte;
 * - grava `support_access_ended` nas duas auditorias, com a causa;
 * - leva toda sessão que estava no acesso de volta para a organização em que o login da conta
 *   cairia (`last_organization_id`, se a conta tem ali vínculo `member` ativo; senão o vínculo
 *   `member` ativo mais antigo). Sem vínculo `member` ativo nenhum, apaga a sessão.
 *
 * `where ended_at is null`: só um caminho grava o fim. Os outros não acham linha e não gravam nada.
 */
async function endInTransaction(q: OrgQuery, supportAccessId: string, now: Date, cause: SupportAccessEndCause, revokedBy: string | null = null): Promise<boolean> {
  const ended = await q.one<{ organizationId: string; userId: string; endedAt: Date }>(
    `update support_accesses
        set ended_at = case when $3::text = 'expired' then expires_at else least($2::timestamptz, expires_at) end
      where id = $1 and ended_at is null and ($3::text <> 'expired' or expires_at <= $2::timestamptz)
      returning organization_id as "organizationId", user_id as "userId", ended_at as "endedAt"`,
    [supportAccessId, now, cause],
  );
  if (!ended) return false;

  // A conta vem do próprio vínculo de suporte, na mesma linha que o desativa.
  const link = await q.one<{ accountId: string }>(
    "update users set disabled_at = coalesce(disabled_at, $3) where id = $1 and organization_id = $2 and kind = 'support' returning account_id as \"accountId\"",
    [ended.userId, ended.organizationId, now],
  );
  if (!link) throw new Error("endSupportAccess: the support link was not found");
  const accountId = link.accountId;

  const detail = { support_access_id: supportAccessId, cause, ended_at: ended.endedAt.toISOString() };
  // Quem encerrou foi a pessoa do suporte; o prazo vencido não tem quem; a revogação tem, na
  // instalação, quem tirou a administração (a organização não o conhece).
  await recordOrgEventIn(q, ended.organizationId, "support_access_ended", detail, now, cause === "ended" ? ended.userId : null);
  await recordInstallationEvent(q, now, "support_access_ended", {
    actorAccountId: cause === "ended" ? accountId : cause === "revoked" ? revokedBy : null,
    organizationId: ended.organizationId,
    payload: detail,
  });

  await q.exec(
    `update sessions s set organization_id = home.organization_id, user_id = home.id, support_access_id = null
       from (select u.organization_id, u.id
               from users u join accounts a on a.id = u.account_id
              where u.account_id = $2 and u.kind = 'member' and u.disabled_at is null
              order by (u.organization_id = a.last_organization_id) desc nulls last, u.created_at, u.id
              limit 1) home
      where s.support_access_id = $1`,
    [supportAccessId, accountId],
  );
  await q.exec("delete from sessions where support_access_id = $1", [supportAccessId]);
  return true;
}

/**
 * Um acesso de suporte, como a organização o vê (a seção "Acessos de suporte" da tela Equipe, na
 * fatia 5d). Quem deu o suporte vem pelo `userId` do vínculo de suporte; o nome dele fica com a 5d.
 */
export interface SupportAccessView {
  id: string;
  userId: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

/** Os acessos de suporte que a organização recebeu, do mais novo ao mais antigo. Por `withOrg`. */
export function listSupportAccesses(db: Db, organizationId: string): Promise<SupportAccessView[]> {
  return withOrg(db, organizationId, (q) =>
    q.many<SupportAccessView>(
      `select id, user_id as "userId", reason, started_at as "startedAt", expires_at as "expiresAt", ended_at as "endedAt"
         from support_accesses order by started_at desc, id`,
    ),
  );
}
