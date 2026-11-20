import type { ServiceData } from "./optional-service";

/**
 * O estado que um cartão da central de Configurações mostra (parte 3 do desenho da central). Cada
 * leitura vem de uma rota `GET` que a tela da área já chama. Sem leitura, ou na dúvida, `null`: o
 * cartão fica sem estado, porque um "pronto" falso é pior que nenhum.
 */
export type HubState = "ready" | "missing" | "off";

/** Motores de voz: a mesma leitura do passo da chave (`engineReady`). */
export const enginesState = (ready: boolean | undefined): HubState | null => (ready === undefined ? null : ready ? "ready" : "missing");

/**
 * WhatsApp por QR Code (`GET /whatsapp`, só para quem configura). "Pronto" só com o serviço no ar
 * (a mesma condição de `up` na tela do WhatsApp) e a sessão conectada. O status gravado não basta:
 * com o serviço fora do ar a rota devolve o último status sem perguntar ao WAHA. Serviço ausente é
 * "desligado"; qualquer outra combinação ainda falta algo.
 */
export function whatsappState(data: Pick<ServiceData, "available" | "service" | "status"> | undefined): HubState | null {
  if (data === undefined) return null;
  if (data.service === "absent") return "off";
  return data.available === true && data.service === "running" && data.status === "connected" ? "ready" : "missing";
}

/** Webhooks (`GET /settings/webhooks.allowed`): nenhum endereço é "desligado"; com algum, sem estado. */
export const webhooksState = (value: readonly unknown[] | null | undefined, loaded: boolean): HubState | null => (loaded && (value ?? []).length === 0 ? "off" : null);
