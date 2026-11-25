import { z } from "zod";
import { callTool, McpHttpError, McpProtocolError } from "../mcp/client";
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

/**
 * Como uma porta do CRM respondeu à conferência:
 * - `ok`: respondeu, com a forma esperada;
 * - `refused`: HTTP 401 ou 403, o token não serve para esta porta (o token só-MCP na REST, por exemplo);
 * - `unreachable`: o pedido não chegou ou não voltou (endereço não público, rede, prazo);
 * - `unexpected`: respondeu, mas com outro HTTP de erro ou fora da forma.
 */
export type DeskcommPortResult = "ok" | "refused" | "unreachable" | "unexpected";

/** Um canal de mensagem do CRM, como a tela o mostra. */
export interface DeskcommChannel {
  id: string;
  provider: string;
  name: string | null;
  phone: string | null;
}

export interface DeskcommCheck {
  /** `POST {crmUrl}/api/mcp`, a porta da agenda: `crm_list_event_types`, que só lê. */
  mcp: DeskcommPortResult;
  /** `GET {crmUrl}/api/v1/channel-sessions`, a porta REST, a mesma do envio. */
  rest: DeskcommPortResult;
  /** Os canais de mensagem que o CRM listou. Vazia quando a REST não respondeu `ok`. */
  channels: DeskcommChannel[];
}

/** O prazo de cada porta na conferência. */
export const DESKCOMM_CHECK_TIMEOUT_SECONDS = 10;
/** Até quantos canais a conferência devolve. */
export const DESKCOMM_CHECK_MAX_CHANNELS = 50;

const channelList = z.looseObject({
  data: z.array(z.looseObject({ id: z.uuid(), provider: z.string().max(40), display_name: z.string().nullish(), phone_number: z.string().nullish() })),
});

/**
 * Confere as duas portas do CRM com o mesmo token, as duas só lendo (issue #330, fatia 2b). O envio
 * de mensagem e a criação de contato vão pela REST, e a agenda pelo MCP: um token só-MCP (`aud:mcp`)
 * passa na primeira e é recusado na segunda, e é isso que a tela avisa. Nada é gravado no CRM.
 * Nunca lança: cada porta volta com o próprio resultado.
 */
export async function checkDeskcomm(crm: { crmUrl: string; token: string }, net: SafeFetchOptions): Promise<DeskcommCheck> {
  const at = (path: string) => new URL(path, crm.crmUrl).toString();
  const timeoutMs = DESKCOMM_CHECK_TIMEOUT_SECONDS * 1000;
  const [mcp, rest] = await Promise.all([checkMcp(at("/api/mcp"), crm.token, { ...net, timeoutMs }), checkRest(at("/api/v1/channel-sessions"), crm.token, { ...net, timeoutMs })]);
  return { mcp, rest: rest.result, channels: rest.channels };
}

async function checkMcp(url: string, token: string, net: SafeFetchOptions): Promise<DeskcommPortResult> {
  try {
    const result = await callTool({ slug: "deskcomm", url, secret: `Bearer ${token}`, timeoutSeconds: DESKCOMM_CHECK_TIMEOUT_SECONDS }, "crm_list_event_types", {}, net);
    return result.isError ? "unexpected" : "ok";
  } catch (error) {
    if (error instanceof McpHttpError) return error.status === 401 || error.status === 403 ? "refused" : "unexpected";
    if (error instanceof McpProtocolError) return "unexpected";
    return "unreachable";
  }
}

async function checkRest(url: string, token: string, net: SafeFetchOptions): Promise<{ result: DeskcommPortResult; channels: DeskcommChannel[] }> {
  let response: SafeResponse;
  try {
    response = await safeFetch(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` } }, { ...net, redirect: "error" });
  } catch {
    return { result: "unreachable", channels: [] };
  }
  if (response.status === 401 || response.status === 403) return { result: "refused", channels: [] };
  if (!response.ok || response.truncated) return { result: "unexpected", channels: [] };
  let parsed: z.infer<typeof channelList>;
  try {
    const read = channelList.safeParse(JSON.parse(response.body));
    if (!read.success) return { result: "unexpected", channels: [] };
    parsed = read.data;
  } catch {
    return { result: "unexpected", channels: [] };
  }
  const channels = parsed.data.slice(0, DESKCOMM_CHECK_MAX_CHANNELS).map((channel) => ({ id: channel.id, provider: channel.provider, name: channel.display_name ?? null, phone: channel.phone_number ?? null }));
  return { result: "ok", channels };
}
