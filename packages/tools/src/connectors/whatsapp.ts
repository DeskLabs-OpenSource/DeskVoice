import { decryptSecret, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { safeFetch, type SafeFetchOptions, type SafeResponse } from "../net/safe-fetch";
import { readSetting } from "../settings";
import { sendViaDeskcomm } from "./deskcomm";

export const WHATSAPP_CONNECTOR_KEY = "whatsapp.connector";

// Como fica em `settings`: `token` cifrado com `encryptSecret`, o resto em claro.
const stored = z.object({ type: z.enum(["deskcomm", "webhook"]), url: z.url(), token: z.string().min(1) });

export interface WhatsAppConnector {
  type: "deskcomm" | "webhook";
  url: string;
  /** Já decifrado. */
  token: string;
}

export interface WhatsAppMessage {
  to: string;
  text: string;
  callId?: string | null;
}

export async function hasWhatsAppConnector(q: OrgQuery): Promise<boolean> {
  return (await readSetting(q, WHATSAPP_CONNECTOR_KEY)) !== null;
}

/** O conector da organização, ou `null` se nenhum foi configurado. Configuração malformada é erro. */
export async function loadWhatsAppConnector(q: OrgQuery, secretKey: Buffer): Promise<WhatsAppConnector | null> {
  const value = await readSetting(q, WHATSAPP_CONNECTOR_KEY);
  if (value === null) return null;
  const parsed = stored.safeParse(value);
  if (!parsed.success) throw new Error(`Setting ${WHATSAPP_CONNECTOR_KEY} is malformed: expected { type: 'deskcomm' | 'webhook', url, token }`);
  return { ...parsed.data, token: decryptSecret(parsed.data.token, secretKey) };
}

/** Envia a mensagem pelo conector. Lança erro se o destino recusar: quem chama decide o que dizer. */
export async function sendWhatsApp(connector: WhatsAppConnector, message: WhatsAppMessage, net: SafeFetchOptions = {}): Promise<void> {
  const response = connector.type === "deskcomm" ? await sendViaDeskcomm(connector, message, net) : await sendViaWebhook(connector, message, net);
  if (!response.ok) throw new Error(`WhatsApp connector (${connector.type}) answered HTTP ${response.status}`);
}

function sendViaWebhook(connector: WhatsAppConnector, message: WhatsAppMessage, net: SafeFetchOptions): Promise<SafeResponse> {
  return safeFetch(
    connector.url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${connector.token}` },
      body: JSON.stringify({ to: message.to, text: message.text, callId: message.callId ?? null }),
    },
    net,
  );
}
