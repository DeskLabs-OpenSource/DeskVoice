import { loadConfig } from "@deskvoice/core";
import type { WhatsAppDeps } from "./connectors/whatsapp";

/** O que uma ferramenta que fala com a rede recebe de fora; em teste, tudo falso. */
export interface ToolDeps extends WhatsAppDeps {
  /** Chave que decifra os segredos de `settings`. Padrão: a da configuração do processo. */
  secretKey?: () => Buffer;
}

export const configSecretKey = (): Buffer => loadConfig(process.env).secretKey;
