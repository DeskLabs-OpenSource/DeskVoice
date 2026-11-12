import { decryptSecret, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { safeFetch, type SafeFetchOptions, type SafeResponse } from "../net/safe-fetch";
import { connectorBody, connectorHeaders } from "./http-request";
import { readSetting } from "../settings";
import { sendViaDeskcomm } from "./deskcomm";
import { sendViaWaha, wahaFromEnv, wahaSessionName, type WahaOptions } from "./waha";

export const WHATSAPP_CONNECTOR_KEY = "whatsapp.connector";

// Como fica em `settings`: `token` cifrado com `encryptSecret`, o resto em claro. O tipo `waha` (o
// número conectado por QR Code) não tem `url` nem `token`: o endereço e a chave são da instalação,
// e um `url` gravado ali é descartado na leitura.
const stored = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["deskcomm", "webhook"]), url: z.url(), token: z.string().min(1) }),
  z.object({ type: z.literal("waha") }),
]);

/** Conector que é um endereço do operador. */
export interface HttpConnector {
  type: "deskcomm" | "webhook";
  url: string;
  /** Já decifrado. */
  token: string;
}
export type WhatsAppConnector = HttpConnector | { type: "waha"; /** Nome da sessão no WAHA. */ session: string };

/** O que o envio recebe de fora; em teste, tudo falso. */
export interface WhatsAppDeps extends SafeFetchOptions {
  /** Acesso ao WAHA da instalação. Padrão: a chave do ambiente do processo. */
  waha?: WahaOptions;
}

export interface WhatsAppMessage {
  to: string;
  text: string;
  callId?: string | null;
  /** Chave de repetição segura (`Idempotency-Key`) nos conectores HTTP. */
  idempotencyKey?: string;
}

export async function hasWhatsAppConnector(q: OrgQuery): Promise<boolean> {
  return (await readSetting(q, WHATSAPP_CONNECTOR_KEY)) !== null;
}

/** O conector da organização, ou `null` se nenhum foi configurado. Configuração malformada é erro. */
export async function loadWhatsAppConnector(q: OrgQuery, secretKey: Buffer): Promise<WhatsAppConnector | null> {
  const value = await readSetting(q, WHATSAPP_CONNECTOR_KEY);
  if (value === null) return null;
  const parsed = stored.safeParse(value);
  if (!parsed.success) throw new Error(`Setting ${WHATSAPP_CONNECTOR_KEY} is malformed: expected { type: 'deskcomm' | 'webhook', url, token } or { type: 'waha' }`);
  if (parsed.data.type === "waha") return { type: "waha", session: wahaSessionName(q.organizationId) };
  return { ...parsed.data, token: decryptSecret(parsed.data.token, secretKey) };
}

/**
 * Envia a mensagem pelo conector. Lança erro se o destino recusar: quem chama decide o que dizer.
 * `addressVerified: false` só acontece no número conectado por QR Code, quando o WhatsApp não pôde
 * confirmar o endereço do número antes do envio.
 */
export async function sendWhatsApp(connector: WhatsAppConnector, message: WhatsAppMessage, net: WhatsAppDeps = {}): Promise<{ addressVerified: boolean }> {
  if (connector.type === "waha") return sendViaWaha(net.waha ?? wahaFromEnv(), connector.session, message);
  const response = connector.type === "deskcomm" ? await sendViaDeskcomm(connector, message, net) : await sendViaWebhook(connector, message, net);
  if (!response.ok) throw new Error(`WhatsApp connector (${connector.type}) answered HTTP ${response.status}`);
  return { addressVerified: true };
}

function sendViaWebhook(connector: HttpConnector, message: WhatsAppMessage, net: SafeFetchOptions): Promise<SafeResponse> {
  const body = connectorBody(message);
  return safeFetch(connector.url, { method: "POST", headers: connectorHeaders(connector.token, message), body }, net);
}
