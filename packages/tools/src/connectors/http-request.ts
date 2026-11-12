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

/** Headers do POST: o token autentica, e a chave de repetição deixa o reenvio seguro. */
export function connectorHeaders(token: string, message: HttpMessage): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(message.idempotencyKey !== undefined && { "Idempotency-Key": message.idempotencyKey }),
  };
}
