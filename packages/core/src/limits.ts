import { recordInstallationEvent } from "./installation";
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
 * Fatia 7a: valem `maxTrunks` e `maxAgents`. `outboundAllowed` (7b) e `monthlySpendCapCents` (7c)
 * são lidos aqui porque a linha já os tem, mas ninguém os grava nem os confere ainda.
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

/** O que esta fatia deixa mudar. A 7b e a 7c abrem as colunas delas. */
export interface OrganizationLimitsPatch {
  maxTrunks?: number | null;
  maxAgents?: number | null;
}

const NO_LIMITS: OrganizationLimits = { monthlySpendCapCents: null, maxTrunks: null, maxAgents: null, outboundAllowed: true };

// Coluna e tabela de cada coisa com limite. Texto fixo daqui: nada de fora entra no SQL.
const COLUMN_OF = { maxTrunks: "max_trunks", maxAgents: "max_agents" } as const;
const TABLE_OF: Record<LimitKind, { table: string; field: keyof typeof COLUMN_OF }> = {
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

/** Os limites e o uso de uma organização, para a área da instalação. `null` se ela não existe. */
export function organizationLimitsView(db: Db, organizationId: string): Promise<OrganizationLimitsView | null> {
  return withOrg(db, organizationId, async (q) => ((await q.one("select 1 from organizations where id = $1", [organizationId])) ? organizationLimitsUsage(q) : null));
}

export type SetOrganizationLimitsResult = { ok: true; limits: OrganizationLimits } | { ok: false; reason: "not_found" };

const isLimit = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

/**
 * Grava os limites de uma organização, pelo papel de sistema (a organização não escreve na tabela).
 * Faz o upsert só das colunas do `patch` e grava `organization_limits_changed` na auditoria da
 * instalação, na mesma transação, com o antes e o depois só das colunas que mudaram e com quem mudou.
 * Nada mudou, nada se grava. `null` tira o limite. Quem confere o papel da instalação é a rota.
 */
export async function setOrganizationLimits(db: Db, organizationId: string, patch: OrganizationLimitsPatch, actorAccountId: string, now: Date): Promise<SetOrganizationLimitsResult> {
  const fields = (Object.keys(COLUMN_OF) as (keyof typeof COLUMN_OF)[]).filter((field) => Object.hasOwn(patch, field) && patch[field] !== undefined);
  for (const field of fields) if (!isLimit(patch[field])) throw new Error(`setOrganizationLimits: ${field} must be a non-negative integer or null`);
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
