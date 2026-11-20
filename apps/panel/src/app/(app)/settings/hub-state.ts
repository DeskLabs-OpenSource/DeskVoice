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
 * WhatsApp por QR Code (`GET /whatsapp`, só para quem configura). "Pronto" só com a sessão
 * conectada: o serviço no ar com o QR por ler, ou desconectado, ainda falta algo.
 */
export function whatsappState(data: Pick<ServiceData, "service" | "status"> | undefined): HubState | null {
  if (data === undefined) return null;
  if (data.status === "connected") return "ready";
  return data.service === "absent" ? "off" : "missing";
}

/** Webhooks (`GET /settings/webhooks.allowed`): nenhum endereço é "desligado"; com algum, sem estado. */
export const webhooksState = (value: readonly unknown[] | null | undefined, loaded: boolean): HubState | null => (loaded && (value ?? []).length === 0 ? "off" : null);
