import { loadConfig } from "@deskvoice/core";
import type { AgendaClient } from "./connectors/agenda";
import type { WhatsAppDeps } from "./connectors/whatsapp";

/** O que uma ferramenta que fala com a rede recebe de fora; em teste, tudo falso. */
export interface ToolDeps extends WhatsAppDeps {
  /** Chave que decifra os segredos de `settings`. Padrão: a da configuração do processo. */
  secretKey?: () => Buffer;
  /**
   * Cliente da agenda. Sem ele, as ferramentas de agenda recusam em voz alta e nada é gravado —
   * é o estado de hoje: o conector com o CRM é a fatia seguinte.
   */
  agenda?: AgendaClient;
}

export const configSecretKey = (): Buffer => loadConfig(process.env).secretKey;
