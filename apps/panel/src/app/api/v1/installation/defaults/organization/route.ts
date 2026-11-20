import { isKnownTimeZone, readOrganizationDefaults, setDefaultTimezone } from "@deskvoice/core";
import { z } from "zod";
import { handleInstallation } from "../../handle";

/**
 * O fuso com que uma organização nova nasce (seção 3.5 do desenho do R8, fatia 8a), ao lado dos limites
 * padrão (`installation/defaults/limits`). Só quem administra a instalação, e nunca pela sessão de
 * suporte. Vale só para as organizações criadas daqui em diante: a nova recebe uma CÓPIA em
 * `outbound_policy.timezone`, e mudar o padrão não mexe em nenhuma que já existe. `null`: sem padrão,
 * a nova nasce com o fuso de sempre.
 */
export const GET = handleInstallation({ support: false }, async ({ deps }) => readOrganizationDefaults(deps.db));

// O mesmo validador do fuso da política de saída. `null` tira o padrão. Campo desconhecido é recusado.
const body = z.object({ timezone: z.string().refine(isKnownTimeZone, "unknown time zone").nullable() }).strict();

/** Grava o padrão e `installation_setting_changed`. */
export const PUT = handleInstallation({ support: false, body }, async ({ body, accountId, deps }) => setDefaultTimezone(deps.db, body.timezone, accountId, deps.clock.now()));
