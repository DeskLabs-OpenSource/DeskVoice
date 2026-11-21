import { costTotal, organizationDays, type CostTotal, type DayRange } from "./costs";
import { DEFAULT_LIMITS_KEY, recordInstallationEvent } from "./installation";
import type { Db, OrgQuery } from "./types";
import { withOrg, withSystem } from "./with-org";

/**
 * Os limites por organização (seção 3.4 do desenho do R8,
 * `docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md`). Quem administra a
 * instalação grava; a organização só lê (`organization_limits` não dá escrita a `deskvoice_app`).
 *
 * Organização sem linha não tem limite nenhum, e coluna nula também é "sem limite". Limite só aperta:
 * baixar abaixo do que já existe não apaga nada, só impede criar mais.
 *
 * Fatia 7a: valem `maxTrunks` e `maxAgents`. Fatia 7b: vale `outboundAllowed`, a trava da saída.
 * `true` não liga a saída, só deixa a organização decidir; `false` desliga a saída e trava o
 * interruptor dela, sem escrever em `outbound_policy`, e quem confere é `checkOutboundAllowed` (a porta
 * única do processo de voz) e a rota da política. Fatia 7c: vale `monthlySpendCapCents`, o teto de gasto
 * do mês, conferido no começo de cada chamada por `spendCapReached`.
 */
export interface OrganizationLimits {
  monthlySpendCapCents: number | null;
  maxTrunks: number | null;
  maxAgents: number | null;
  outboundAllowed: boolean;
}

/** O que existe de cada coisa que tem limite. */
export type LimitKind = "trunks" | "agents";

/** O código da recusa, igual na rota de linhas e na de agentes. */
export const ORGANIZATION_LIMIT_REACHED = "organization_limit_reached";

/** A recusa da trava da saída (7b), igual no processo de voz e na rota da política. */
export const OUTBOUND_NOT_ALLOWED = "outbound_not_allowed";

/** A recusa do teto de gasto do mês (7c), igual nas quatro portas e em `calls.end_reason`. */
export const SPEND_CAP_REACHED = "spend_cap_reached";

/** O que se deixa mudar. `outboundAllowed` não aceita nulo: a coluna é `not null`. */
export interface OrganizationLimitsPatch {
  monthlySpendCapCents?: number | null;
  maxTrunks?: number | null;
  maxAgents?: number | null;
  outboundAllowed?: boolean;
}

const NO_LIMITS: OrganizationLimits = { monthlySpendCapCents: null, maxTrunks: null, maxAgents: null, outboundAllowed: true };

// Coluna e tabela de cada coisa com limite. Texto fixo daqui: nada de fora entra no SQL.
const COLUMN_OF = { monthlySpendCapCents: "monthly_spend_cap_cents", maxTrunks: "max_trunks", maxAgents: "max_agents", outboundAllowed: "outbound_allowed" } as const;
const TABLE_OF: Record<LimitKind, { table: string; field: "maxTrunks" | "maxAgents" }> = {
  trunks: { table: "trunks", field: "maxTrunks" },
  agents: { table: "agents", field: "maxAgents" },
};

const LIMITS_SQL = `select monthly_spend_cap_cents as "monthlySpendCapCents", max_trunks as "maxTrunks", max_agents as "maxAgents", outbound_allowed as "outboundAllowed"
                      from organization_limits where organization_id = $1`;

/** Os limites da organização da transação (`withOrg`). Sem linha, nenhum limite. */
export async function organizationLimits(q: OrgQuery): Promise<OrganizationLimits> {
  if (q.organizationId === "") throw new Error("organizationLimits: needs a transaction of the organization (withOrg)");
  return (await q.one<OrganizationLimits & Record<string, unknown>>(LIMITS_SQL, [q.organizationId])) ?? { ...NO_LIMITS };
}

export type BelowLimitResult = { ok: true } | { ok: false; kind: LimitKind; count: number; limit: number };

/**
 * Confere, antes de criar uma linha telefônica ou um agente, se a organização da transação ainda tem
 * vaga. Chame na MESMA transação do `insert`, antes dele. Tranca a linha da organização
 * (`for no key update`, a mesma trava de `inboundLimitReached`): duas criações juntas esperam uma
 * pela outra, e a segunda conta a primeira. Sem limite, passa. No limite ou acima dele, recusa.
 */
export async function assertBelowLimit(q: OrgQuery, kind: LimitKind): Promise<BelowLimitResult> {
  if (q.organizationId === "") throw new Error("assertBelowLimit: needs a transaction of the organization (withOrg)");
  await q.one("select 1 as locked from organizations where id = $1 for no key update", [q.organizationId]);
  const limit = (await organizationLimits(q))[TABLE_OF[kind].field];
  if (limit === null) return { ok: true };
  const row = await q.one<{ n: number }>(`select count(*)::int as n from ${TABLE_OF[kind].table} where organization_id = $1`, [q.organizationId]);
  const count = row?.n ?? 0;
  return count >= limit ? { ok: false, kind, count, limit } : { ok: true };
}

export interface MonthCost extends DayRange, CostTotal {}

/**
 * O custo do mês corrente da organização da transação, do dia 1 até hoje, no fuso dela: a mesma
 * `costTotal` da tela de Custos e da visão geral da instalação, nunca outra soma.
 */
export async function monthCost(q: OrgQuery, now: Date): Promise<MonthCost> {
  const days = await organizationDays(q, now);
  const month = { from: days.monthStart, to: days.today };
  return { ...month, ...(await costTotal(q, month)) };
}

export type SpendCapCheck = { reached: false } | { reached: true; capCents: number; spentMicrocents: number };

/**
 * O teto de gasto do mês (seção 3.4 do desenho do R8, fatia 7c), conferido no começo de cada chamada,
 * na transação da organização (`withOrg`). Sem linha de limites ou com a coluna nula, não há teto e
 * nada é somado: a instalação sem teto não paga a consulta. Com teto, soma o mês por `monthCost` e
 * recusa quando a soma chegou ao teto. A comparação converte o teto para microcentavos, e nunca
 * arredonda a soma; teto 0 recusa toda chamada.
 *
 * A soma inclui o custo estimado e não inclui o que não pôde ser medido: o teto é aproximado. A
 * chamada em andamento não é cortada quando a soma passa do teto; quem a limita é o teto por chamada
 * do agente.
 *
 * `limits`, quando a porta já leu `organizationLimits(q)` na mesma transação (a saída e a religação, para
 * a trava): o teto vem dele, sem reler, e a organização sem teto não ganha consulta nenhuma.
 */
export async function spendCapReached(q: OrgQuery, now: Date, limits?: OrganizationLimits): Promise<SpendCapCheck> {
  if (q.organizationId === "") throw new Error("spendCapReached: needs a transaction of the organization (withOrg)");
  const capCents = (limits ?? (await organizationLimits(q))).monthlySpendCapCents;
  if (capCents === null) return { reached: false };
  const spentMicrocents = (await monthCost(q, now)).microcents;
  return spentMicrocents >= capCents * 1_000_000 ? { reached: true, capCents, spentMicrocents } : { reached: false };
}

export interface OrganizationLimitsView {
  limits: OrganizationLimits;
  /** Quanto a organização já usa de cada coisa com limite. */
  usage: Record<LimitKind, number>;
}

/** Os limites e o uso da organização da transação (`withOrg`): a leitura em Configurações. */
export async function organizationLimitsUsage(q: OrgQuery): Promise<OrganizationLimitsView> {
  const usage = await q.one<{ trunks: number; agents: number }>(
    "select (select count(*)::int from trunks where organization_id = $1) as trunks, (select count(*)::int from agents where organization_id = $1) as agents",
    [q.organizationId],
  );
  return { limits: await organizationLimits(q), usage: { trunks: usage?.trunks ?? 0, agents: usage?.agents ?? 0 } };
}

export interface InstallationLimitsView extends OrganizationLimitsView {
  /** A escolha da organização em `outbound_policy` (sem linha, desligada). Lida, nunca escrita daqui. */
  outboundPolicyEnabled: boolean;
  /** O custo do mês corrente, a soma que o teto confere (`monthCost`). */
  monthCost: MonthCost;
}

/**
 * Os limites e o uso de uma organização, para a área da instalação, com a escolha dela sobre a saída
 * (a tela diz, antes de destravar, como a saída volta) e com o custo do mês ao lado do teto. `null` se
 * ela não existe.
 */
export function organizationLimitsView(db: Db, organizationId: string, now: Date): Promise<InstallationLimitsView | null> {
  return withOrg(db, organizationId, async (q) => {
    if (!(await q.one("select 1 from organizations where id = $1", [organizationId]))) return null;
    const policy = await q.one<{ enabled: boolean }>("select enabled from outbound_policy where organization_id = $1", [organizationId]);
    return { ...(await organizationLimitsUsage(q)), outboundPolicyEnabled: policy?.enabled ?? false, monthCost: await monthCost(q, now) };
  });
}

export type SetOrganizationLimitsResult = { ok: true; limits: OrganizationLimits } | { ok: false; reason: "not_found" };

/** O teto de `maxTrunks` e `maxAgents`: a rota e o core usam este número, e nenhum outro. */
export const MAX_COUNT_LIMIT = 1_000_000;

/** O teto de `monthlySpendCapCents`, em centavos: o maior `integer` do Postgres, o tipo da coluna. */
export const MAX_SPEND_CAP_CENTS = 2_147_483_647;

const isLimit = (value: unknown, max: number): value is number | null => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max);
// As três portas (`setOrganizationLimits`, `setDefaultLimits` e a leitura de `defaults.limits`) passam por aqui.
const isValid = (field: keyof typeof COLUMN_OF, value: unknown): boolean => {
  if (field === "outboundAllowed") return typeof value === "boolean";
  return isLimit(value, field === "monthlySpendCapCents" ? MAX_SPEND_CAP_CENTS : MAX_COUNT_LIMIT);
};
const ruleOf = (field: keyof typeof COLUMN_OF): string =>
  field === "outboundAllowed" ? "true or false" : `a non-negative integer up to ${field === "monthlySpendCapCents" ? MAX_SPEND_CAP_CENTS : MAX_COUNT_LIMIT}, or null`;

/**
 * Grava os limites de uma organização, pelo papel de sistema (a organização não escreve na tabela).
 * Faz o upsert só das colunas do `patch` e grava `organization_limits_changed` na auditoria da
 * instalação, na mesma transação, com o antes e o depois só das colunas que mudaram e com quem mudou.
 * Nada mudou, nada se grava. `null` tira o limite. Quem confere o papel da instalação é a rota.
 * `outboundAllowed` grava só a trava: `outbound_policy`, a escolha da organização, fica como ela deixou.
 */
export async function setOrganizationLimits(db: Db, organizationId: string, patch: OrganizationLimitsPatch, actorAccountId: string, now: Date): Promise<SetOrganizationLimitsResult> {
  const fields = (Object.keys(COLUMN_OF) as (keyof typeof COLUMN_OF)[]).filter((field) => Object.hasOwn(patch, field) && patch[field] !== undefined);
  for (const field of fields) {
    if (!isValid(field, patch[field])) throw new Error(`setOrganizationLimits: ${field} must be ${ruleOf(field)}`);
  }
  return withSystem(db, async (q): Promise<SetOrganizationLimitsResult> => {
    // A mesma trava de `assertBelowLimit`: duas mudanças juntas não gravam um "antes" que já passou.
    if (!(await q.one("select 1 as locked from organizations where id = $1 for no key update", [organizationId]))) return { ok: false, reason: "not_found" };
    const current = (await q.one<OrganizationLimits & Record<string, unknown>>(LIMITS_SQL, [organizationId])) ?? { ...NO_LIMITS };
    const changed = fields.filter((field) => current[field] !== patch[field]);
    if (changed.length === 0) return { ok: true, limits: current };
    const columns = changed.map((field) => COLUMN_OF[field]);
    const values = changed.map((field) => patch[field] ?? null);
    await q.exec(
      `insert into organization_limits (organization_id, updated_at, ${columns.join(", ")}) values ($1, $2, ${columns.map((_, i) => `$${i + 3}`).join(", ")})
       on conflict (organization_id) do update set updated_at = excluded.updated_at, ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}`,
      [organizationId, now, ...values],
    );
    const before = Object.fromEntries(changed.map((field) => [COLUMN_OF[field], current[field]]));
    const after = Object.fromEntries(changed.map((field) => [COLUMN_OF[field], patch[field] ?? null]));
    await recordInstallationEvent(q, now, "organization_limits_changed", { actorAccountId, organizationId, payload: { before, after } });
    return { ok: true, limits: { ...current, ...Object.fromEntries(changed.map((field) => [field, patch[field] ?? null])) } };
  });
}

/**
 * O padrão de fábrica dos limites de uma organização nova (seção 3.5 do desenho do R8, fatia 7d):
 * nenhum limite, e a saída travada. Vale enquanto `defaults.limits` não foi gravada.
 */
export const FACTORY_DEFAULT_LIMITS: OrganizationLimits = { monthlySpendCapCents: null, maxTrunks: null, maxAgents: null, outboundAllowed: false };

// Uma chave gravada à mão com campo estranho não vira limite: o campo que não passa (tipo errado, ou acima
// do teto, que a coluna `integer` não guardaria) volta ao de fábrica, e a criação da organização não falha.
function readDefaults(value: unknown): OrganizationLimits {
  const stored = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const limits = { ...FACTORY_DEFAULT_LIMITS };
  for (const field of Object.keys(COLUMN_OF) as (keyof typeof COLUMN_OF)[]) {
    if (Object.hasOwn(stored, field) && isValid(field, stored[field])) Object.assign(limits, { [field]: stored[field] });
  }
  return limits;
}

/**
 * Os limites com que uma organização nova nasce (`defaults.limits` em `installation_settings`). Sem a
 * chave, o padrão de fábrica: nenhum limite e a saída travada. `q` tem de ser de `withSystem`.
 */
export async function defaultLimits(q: OrgQuery): Promise<OrganizationLimits> {
  const row = await q.one<{ value: unknown }>("select value from installation_settings where key = $1", [DEFAULT_LIMITS_KEY]);
  return row ? readDefaults(row.value) : { ...FACTORY_DEFAULT_LIMITS };
}

/** `defaultLimits` pelo papel de sistema, para a rota da área da instalação, que não abre esse papel. */
export function readDefaultLimits(db: Db): Promise<OrganizationLimits> {
  return withSystem(db, (q) => defaultLimits(q));
}

/** Uma mudança do padrão por vez: duas juntas não gravam um "antes" que já passou. */
const DEFAULT_LIMITS_LOCK_SQL = "select pg_advisory_xact_lock(hashtextextended('deskvoice:defaults.limits', 0))";

/**
 * Grava os limites com que uma organização nova nasce, pelo papel de sistema, e
 * `installation_setting_changed` na auditoria da instalação, na mesma transação, com a chave, o antes e
 * o depois só dos campos que mudaram e com quem mudou. As regras dos campos são as de
 * `setOrganizationLimits`. Nada mudou, nada se grava. A chave guarda os quatro campos.
 *
 * Vale só para as organizações criadas daqui em diante: `addOrganization` COPIA o padrão para a linha
 * da organização nova, e mudar o padrão depois não mexe em nenhuma organização que já existe.
 */
export async function setDefaultLimits(db: Db, patch: OrganizationLimitsPatch, actorAccountId: string, now: Date): Promise<OrganizationLimits> {
  const fields = (Object.keys(COLUMN_OF) as (keyof typeof COLUMN_OF)[]).filter((field) => Object.hasOwn(patch, field) && patch[field] !== undefined);
  for (const field of fields) {
    if (!isValid(field, patch[field])) throw new Error(`setDefaultLimits: ${field} must be ${ruleOf(field)}`);
  }
  return withSystem(db, async (q) => {
    await q.exec(DEFAULT_LIMITS_LOCK_SQL);
    const current = await defaultLimits(q);
    const changed = fields.filter((field) => current[field] !== patch[field]);
    if (changed.length === 0) return current;
    const next: OrganizationLimits = { ...current, ...Object.fromEntries(changed.map((field) => [field, patch[field] ?? null])) };
    await q.exec(
      "insert into installation_settings (key, value, updated_at) values ($1, $2, $3) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at",
      [DEFAULT_LIMITS_KEY, next, now],
    );
    const before = Object.fromEntries(changed.map((field) => [COLUMN_OF[field], current[field]]));
    const after = Object.fromEntries(changed.map((field) => [COLUMN_OF[field], next[field]]));
    await recordInstallationEvent(q, now, "installation_setting_changed", { actorAccountId, payload: { key: DEFAULT_LIMITS_KEY, before, after } });
    return next;
  });
}

/**
 * Grava a linha de limites da organização que acabou de nascer, com o padrão COPIADO (seção 3.5). Só
 * `addOrganization` chama, na transação dela: a fundadora, as que já existem, `create-owner` e a
 * demonstração não passam por aqui e continuam sem linha. `q` tem de ser de `withSystem`.
 */
export async function copyDefaultLimits(q: OrgQuery, organizationId: string, now: Date): Promise<OrganizationLimits> {
  const limits = await defaultLimits(q);
  await q.exec(
    `insert into organization_limits (organization_id, updated_at, monthly_spend_cap_cents, max_trunks, max_agents, outbound_allowed)
     values ($1, $2, $3, $4, $5, $6)`,
    [organizationId, now, limits.monthlySpendCapCents, limits.maxTrunks, limits.maxAgents, limits.outboundAllowed],
  );
  return limits;
}
