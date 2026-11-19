import { readDefaultLimits, setDefaultLimits } from "@deskvoice/core";
import { limitsBody } from "../../../../../../server/limits";
import { handleInstallation } from "../../handle";

/**
 * Os limites com que uma organização nova nasce (seção 3.5 do desenho do R8, fatia 7d). Só quem
 * administra a instalação, e nunca pela sessão de suporte. Valem só para as organizações criadas daqui
 * em diante: a nova recebe uma CÓPIA, e mudar o padrão não mexe em nenhuma que já existe. Sem padrão
 * gravado, nenhum limite e a saída travada.
 */
export const GET = handleInstallation({ support: false }, async ({ deps }) => readDefaultLimits(deps.db));

/** Grava o padrão (mesmas regras do `PUT` de limites da organização) e `installation_setting_changed`. */
export const PUT = handleInstallation({ support: false, body: limitsBody }, async ({ body, accountId, deps }) => setDefaultLimits(deps.db, body, accountId, deps.clock.now()));
