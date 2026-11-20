import { DEFAULT_TIMEZONE_KEY, recordInstallationEvent } from "./installation";
import type { Db, OrgQuery } from "./types";
import { withSystem } from "./with-org";

/**
 * O fuso com que uma organização nova nasce (seção 3.5 do desenho do R8, fatia 8a). Como os limites
 * padrão (`defaultLimits` em `limits.ts`), é COPIADO na criação: `addOrganization` grava o fuso em
 * `outbound_policy.timezone` da nova, que é o fuso da janela de ligações e o do mês de custo
 * (`costTotal`). Mudar o padrão depois não mexe em nenhuma organização que já existe: nenhuma leitura
 * de organização olha para `defaults.timezone`.
 */

/**
 * Um nome de fuso IANA que o Node conhece. É o validador do fuso da política de saída
 * (`PUT /outbound-policy`) e do padrão das organizações novas: o mesmo nos dois lugares.
 */
export function isKnownTimeZone(zone: unknown): zone is string {
  return typeof zone === "string" && Intl.supportedValuesOf("timeZone").includes(zone);
}

/** O que a área da instalação mostra e grava como padrão das organizações novas, além dos limites. */
export interface OrganizationDefaults {
  /** `null`: sem padrão, a nova nasce com o fuso de sempre (o padrão da coluna, `America/Sao_Paulo`). */
  timezone: string | null;
}

/**
 * O fuso com que uma organização nova nasce, ou `null` sem padrão gravado. Uma chave gravada à mão com
 * um valor que não é fuso conhecido vale como sem padrão. `q` tem de ser de `withSystem`.
 */
export async function defaultTimezone(q: OrgQuery): Promise<string | null> {
  const row = await q.one<{ value: unknown }>("select value from installation_settings where key = $1", [DEFAULT_TIMEZONE_KEY]);
  return row && isKnownTimeZone(row.value) ? row.value : null;
}

/** O padrão das organizações novas pelo papel de sistema, para a rota da área da instalação. */
export function readOrganizationDefaults(db: Db): Promise<OrganizationDefaults> {
  return withSystem(db, async (q) => ({ timezone: await defaultTimezone(q) }));
}

/** Uma mudança do padrão por vez: duas juntas não gravam um "antes" que já passou. */
const DEFAULT_TIMEZONE_LOCK_SQL = "select pg_advisory_xact_lock(hashtextextended('deskvoice:defaults.timezone', 0))";

/**
 * Grava (ou, com `null`, tira) o fuso com que uma organização nova nasce, pelo papel de sistema, e
 * `installation_setting_changed` na auditoria da instalação, na mesma transação, com a chave, o antes,
 * o depois e quem mudou. Fuso desconhecido é recusado com erro. Nada mudou, nada se grava.
 */
export async function setDefaultTimezone(db: Db, timezone: string | null, actorAccountId: string, now: Date): Promise<OrganizationDefaults> {
  if (timezone !== null && !isKnownTimeZone(timezone)) throw new Error("setDefaultTimezone: timezone must be a known IANA time zone or null");
  return withSystem(db, async (q) => {
    await q.exec(DEFAULT_TIMEZONE_LOCK_SQL);
    const current = await defaultTimezone(q);
    if (current === timezone) return { timezone };
    // Tirar o padrão grava o `null` do JSON, e não apaga a linha: o papel de sistema não apaga nada em
    // `installation_settings`. `defaultTimezone` lê o `null` como sem padrão.
    await q.exec(
      "insert into installation_settings (key, value, updated_at) values ($1, coalesce(to_jsonb($2::text), 'null'::jsonb), $3) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at",
      [DEFAULT_TIMEZONE_KEY, timezone, now],
    );
    await recordInstallationEvent(q, now, "installation_setting_changed", { actorAccountId, payload: { key: DEFAULT_TIMEZONE_KEY, before: current, after: timezone } });
    return { timezone };
  });
}
