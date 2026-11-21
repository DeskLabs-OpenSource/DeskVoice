import { SPOKEN_LANGUAGES, isKnownTimeZone, readOrganizationDefaults, setOrganizationDefaults } from "@deskvoice/core";
import { z } from "zod";
import { handleInstallation } from "../../handle";

/**
 * O fuso e o idioma com que uma organização nova nasce (seção 3.5 do desenho do R8, fatia 8a), ao lado
 * dos limites padrão (`installation/defaults/limits`). Só quem administra a instalação, e nunca pela
 * sessão de suporte. Valem só para as organizações criadas daqui em diante: a nova recebe uma CÓPIA
 * (o fuso em `outbound_policy.timezone`, o idioma em `organizations.language`), e mudar o padrão não
 * mexe em nenhuma que já existe. `null`: sem padrão, a nova nasce como sempre.
 */
export const GET = handleInstallation({ support: false }, async ({ deps }) => readOrganizationDefaults(deps.db));

// O fuso passa pelo mesmo validador do fuso da política de saída; o idioma, pela lista do painel (o
// mesmo `check` da coluna). Campo ausente fica como está; `null` tira o padrão. Campo desconhecido é recusado.
const body = z
  .object({
    timezone: z.string().refine(isKnownTimeZone, "unknown time zone").nullable().optional(),
    language: z.enum(SPOKEN_LANGUAGES).nullable().optional(),
  })
  .strict()
  .refine((change) => change.timezone !== undefined || change.language !== undefined, "timezone or language is required");

/** Grava o padrão e um `installation_setting_changed` por campo que mudou. */
export const PUT = handleInstallation({ support: false, body }, async ({ body, accountId, deps }) => setOrganizationDefaults(deps.db, body, accountId, deps.clock.now()));
