import { safeFetch, type SafeFetchOptions, type SafeResponse } from "../net/safe-fetch";
import type { HttpConnector, WhatsAppMessage } from "./whatsapp";

/**
 * Envio pelo DeskcommCRM.
 *
 * O contrato da API do DeskcommCRM para receber mensagens de fora ainda precisa ser confirmado.
 * Até lá este conector fala o mesmo formato do conector `webhook` (POST JSON com Bearer) na URL
 * que o operador cadastrou, e nenhum endpoint do Deskcomm é presumido aqui. Confirmado o
 * contrato, só este arquivo muda.
 */
export function sendViaDeskcomm(connector: HttpConnector, message: WhatsAppMessage, net: SafeFetchOptions): Promise<SafeResponse> {
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
