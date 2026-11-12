import { createHmac } from "node:crypto";

/**
 * O que os conectores HTTP (`deskcomm` e `webhook`) mandam: o número, o texto e, quando existe, a
 * chamada de origem.
 */
export interface HttpMessage {
  to: string;
  text: string;
  callId?: string | null;
  /**
   * Vira o header `Idempotency-Key`. Quem recebe guarda o recibo da primeira entrega e devolve o
   * mesmo para a chave repetida, em vez de mandar a mensagem duas vezes.
   */
  idempotencyKey?: string;
}

/** Corpo do POST. Os dois conectores HTTP falam o mesmo formato: é o que o operador vê no destino. */
export function connectorBody(message: HttpMessage): string {
  return JSON.stringify({ to: message.to, text: message.text, callId: message.callId ?? null });
}

/** HMAC-SHA256 de `<instante>.<corpo>`, com o token do conector como chave. */
export function signatureOf(token: string, timestamp: string, body: string): string {
  return createHmac("sha256", token).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Headers do POST. O instante entra na assinatura para uma requisição capturada não valer para
 * sempre: quem recebe recusa fora da janela que aceitar. O token continua indo no `Authorization`
 * porque o destino pode autenticar só por ele; a assinatura é o que prova que o corpo não mudou no
 * caminho.
 */
export function connectorHeaders(token: string, body: string, message: HttpMessage, now: Date = new Date()): Record<string, string> {
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-DeskVoice-Timestamp": timestamp,
    "X-DeskVoice-Signature": `sha256=${signatureOf(token, timestamp, body)}`,
    ...(message.idempotencyKey !== undefined && { "Idempotency-Key": message.idempotencyKey }),
  };
}
