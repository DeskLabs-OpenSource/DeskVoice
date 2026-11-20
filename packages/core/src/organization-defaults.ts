import { DEFAULT_LANGUAGE_KEY, DEFAULT_TIMEZONE_KEY, recordInstallationEvent } from "./installation";
import { SPOKEN_LANGUAGES, type SpokenLanguage } from "./spoken-language";
import type { Db, OrgQuery } from "./types";
import { withSystem } from "./with-org";

/**
 * O fuso com que uma organização nova nasce (seção 3.5 do desenho do R8, fatia 8a). Como os limites
 * padrão (`defaultLimits` em `limits.ts`), é COPIADO na criação: `addOrganization` grava o fuso em
 * `outbound_policy.timezone` da nova, que é o fuso da janela de ligações e o do mês de custo
 * (`costTotal`). Mudar o padrão depois não mexe em nenhuma organização que já existe: nenhuma leitura
 * de organização olha para `defaults.timezone`.
 *
 * O idioma (`defaults.language`) segue a mesma regra: `addOrganization` grava uma cópia em
 * `organizations.language` da nova, e é ESSA coluna que os formulários de agente novo e de menu novo
 * propõem (`proposedLanguage`, no painel). Nenhuma leitura da organização olha para `defaults.language`.
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
  /** `null`: sem padrão, a nova nasce sem idioma e os formulários propõem pt-BR, como sempre. */
  language: SpokenLanguage | null;
}

/** Um dos idiomas que o painel tem (`SPOKEN_LANGUAGES`): o mesmo `check` da coluna `organizations.language`. */
export function isOrganizationLanguage(language: unknown): language is SpokenLanguage {
  return typeof language === "string" && (SPOKEN_LANGUAGES as readonly string[]).includes(language);
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
  return withSystem(db, async (q) => ({ timezone: await defaultTimezone(q), language: await defaultLanguage(q) }));
}

/**
 * O idioma com que uma organização nova nasce, ou `null` sem padrão gravado. Uma chave gravada à mão
 * com um valor fora da lista vale como sem padrão. `q` tem de ser de `withSystem`.
 */
export async function defaultLanguage(q: OrgQuery): Promise<SpokenLanguage | null> {
  const row = await q.one<{ value: unknown }>("select value from installation_settings where key = $1", [DEFAULT_LANGUAGE_KEY]);
  return row && isOrganizationLanguage(row.value) ? row.value : null;
}

/** Uma mudança do padrão por vez: duas juntas não gravam um "antes" que já passou. */
const ORGANIZATION_DEFAULTS_LOCK_SQL = "select pg_advisory_xact_lock(hashtextextended('deskvoice:defaults.organization', 0))";

/**
 * Grava o padrão das organizações novas, pelo papel de sistema, numa transação só: cada campo presente
 * em `change` é gravado (ou, com `null`, tirado), e o ausente fica como está. Cada campo que mudou grava
 * o seu `installation_setting_changed` na auditoria da instalação, com a chave, o antes, o depois e quem
 * mudou. Fuso desconhecido ou idioma fora da lista é recusado com erro, antes de gravar qualquer coisa.
 * Nada mudou, nada se grava.
 */
export async function setOrganizationDefaults(db: Db, change: Partial<OrganizationDefaults>, actorAccountId: string, now: Date): Promise<OrganizationDefaults> {
  if (change.timezone != null && !isKnownTimeZone(change.timezone)) throw new Error("setOrganizationDefaults: timezone must be a known IANA time zone or null");
  if (change.language != null && !isOrganizationLanguage(change.language)) throw new Error("setOrganizationDefaults: language must be pt-BR, en, es or null");
  return withSystem(db, async (q) => {
    await q.exec(ORGANIZATION_DEFAULTS_LOCK_SQL);
    const current: OrganizationDefaults = { timezone: await defaultTimezone(q), language: await defaultLanguage(q) };
    if (change.timezone !== undefined) await writeDefault(q, DEFAULT_TIMEZONE_KEY, current.timezone, change.timezone, actorAccountId, now);
    if (change.language !== undefined) await writeDefault(q, DEFAULT_LANGUAGE_KEY, current.language, change.language, actorAccountId, now);
    return { timezone: change.timezone === undefined ? current.timezone : change.timezone, language: change.language === undefined ? current.language : change.language };
  });
}

/**
 * Grava um padrão de texto e o evento, com o antes e o depois, quando ele muda. Tirar o padrão grava
 * o `null` do JSON, e não apaga a linha: o papel de sistema não apaga nada em `installation_settings`.
 * As leituras (`defaultTimezone`, `defaultLanguage`) leem o `null` como sem padrão.
 */
async function writeDefault(q: OrgQuery, key: string, before: string | null, after: string | null, actorAccountId: string, now: Date): Promise<void> {
  if (before === after) return;
  await q.exec(
    "insert into installation_settings (key, value, updated_at) values ($1, coalesce(to_jsonb($2::text), 'null'::jsonb), $3) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at",
    [key, after, now],
  );
  await recordInstallationEvent(q, now, "installation_setting_changed", { actorAccountId, payload: { key, before, after } });
}
