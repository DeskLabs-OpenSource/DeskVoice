import { z } from "zod";
import { safeFetch, type SafeFetchOptions, type SafeResponse } from "../net/safe-fetch";
import { connectorBody, connectorHeaders } from "./http-request";
import type { HttpConnector, WhatsAppMessage } from "./whatsapp";

/**
 * Envio pelo DeskcommCRM.
 *
 * Duas formas, decididas pelo que está gravado (issue #330, fatia 2):
 *
 * - **Sem `crmUrl`** (quem instalou antes): exatamente como sempre, o formato do conector `webhook`
 *   (`{ to, text, callId }`, POST JSON com Bearer) na URL que o operador digitou, que pode ser um
 *   intermediário próprio. Nada muda para essa instalação.
 * - **Com `crmUrl`**: o contrato do CRM. `POST /api/v1/messages` com `phone_number` e `body`
 *   (melgarafael/DeskcommCRM#4522), e o CRM escolhe o canal pela regra dele. Com um canal escolhido
 *   (`channelSessionId`), a conversa abre antes por `POST /api/v1/conversations/open-with-contact`, e
 *   a mensagem vai com o `conversation_id` que voltou: é assim que ela sai por um número de SMS.
 *
 * As duas rotas pedem o token `dsk_` com `mcp:write`. Um token só-MCP (`aud:mcp`) é recusado fora do
 * `/api/mcp`, e a recusa chega aqui como HTTP de erro. A `Idempotency-Key` cobre o envio; abrir a
 * conversa acha ou cria, e repetir não duplica.
 */
export async function sendViaDeskcomm(connector: HttpConnector, message: WhatsAppMessage, net: SafeFetchOptions): Promise<SafeResponse> {
  if (connector.crmUrl === undefined) {
    return safeFetch(connector.url, { method: "POST", headers: connectorHeaders(connector.token, message), body: connectorBody(message) }, net);
  }

  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${connector.token}` };
  const crm = (path: string) => new URL(path, connector.crmUrl).toString();

  let target: { phone_number: string } | { conversation_id: string } = { phone_number: message.to };
  if (connector.channelSessionId !== undefined) {
    const opened = await safeFetch(
      crm("/api/v1/conversations/open-with-contact"),
      { method: "POST", headers: auth, body: JSON.stringify({ phone_number: message.to, channel_session_id: connector.channelSessionId }) },
      net,
    );
    if (!opened.ok) return opened;
    const conversationId = conversationOf(opened.body);
    // 2xx fora da forma: devolvido como recusa, para quem chama não ler "enviado".
    if (conversationId === null) return { ...opened, ok: false, status: 502 };
    target = { conversation_id: conversationId };
  }

  return safeFetch(crm("/api/v1/messages"), { method: "POST", headers: connectorHeaders(connector.token, message), body: JSON.stringify({ ...target, body: message.text }) }, net);
}

const opened = z.looseObject({ data: z.looseObject({ conversation_id: z.uuid() }) });

function conversationOf(body: string): string | null {
  try {
    const parsed = opened.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.data.conversation_id : null;
  } catch {
    return null;
  }
}
