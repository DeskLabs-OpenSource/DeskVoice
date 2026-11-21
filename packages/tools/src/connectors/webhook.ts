import { decryptSecret, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { safeFetch, type SafeFetchOptions, type SafeResponse } from "../net/safe-fetch";
import { readSetting } from "../settings";
import type { WebhookEvent } from "./webhook-events";
import { WEBHOOK_DEFAULT_TIMEOUT_SECONDS, WEBHOOK_MAX_TIMEOUT_SECONDS, WEBHOOK_MIN_TIMEOUT_SECONDS } from "./webhook-timeout";

export * from "./webhook-events";
export * from "./webhook-timeout";

export const ALLOWED_WEBHOOKS_KEY = "webhooks.allowed";

// Como fica em `settings`: `token`, quando existe, cifrado com `encryptSecret`. `timeoutSeconds`
// ausente (toda lista gravada antes dele) vale o prazo padrão. `events` ausente é nenhum: o webhook
// não recebe nada fora da ligação, que é o de fábrica. Evento que esta versão não conhece (gravado por
// uma mais nova) é ignorado, em vez de deixar a lista inteira ilegível para o `call_webhook`.
const stored = z.array(
  z.object({
    name: z.string().min(1),
    url: z.url(),
    token: z.string().min(1).optional(),
    timeoutSeconds: z.number().int().min(WEBHOOK_MIN_TIMEOUT_SECONDS).max(WEBHOOK_MAX_TIMEOUT_SECONDS).optional(),
    events: z.array(z.string()).optional(),
  }),
);

export interface RegisteredWebhook {
  name: string;
  url: string;
  /** Já decifrado. */
  token?: string;
  /** Quanto esperar a resposta, em segundos. Ausente vale `WEBHOOK_DEFAULT_TIMEOUT_SECONDS`. */
  timeoutSeconds?: number;
  /** Os acontecimentos que ele pediu para receber (`WEBHOOK_EVENTS`). Ausente é nenhum. */
  events?: string[];
}

/** Os webhooks que o operador cadastrou. São os únicos destinos que o produto chama. */
export async function loadAllowedWebhooks(q: OrgQuery, secretKey: Buffer): Promise<RegisteredWebhook[]> {
  const value = await readSetting(q, ALLOWED_WEBHOOKS_KEY);
  if (value === null) return [];
  const parsed = stored.safeParse(value);
  if (!parsed.success) throw new Error(`Setting ${ALLOWED_WEBHOOKS_KEY} is malformed: expected [{ name, url, token?, timeoutSeconds?, events? }]`);
  return parsed.data.map((hook) => ({ ...hook, token: hook.token === undefined ? undefined : decryptSecret(hook.token, secretKey) }));
}

/**
 * Os nomes dos webhooks que pediram o acontecimento, na ordem da lista. Não decifra token nenhum:
 * serve a quem só enfileira a entrega, dentro da transação de outra rotina. Por isso não lança: a
 * lista gravada fora da forma não recebe nada, e não desfaz o resumo nem a leitura da ligação.
 */
export async function webhooksWanting(q: OrgQuery, event: WebhookEvent): Promise<string[]> {
  const parsed = stored.safeParse(await readSetting(q, ALLOWED_WEBHOOKS_KEY));
  if (!parsed.success) return [];
  return parsed.data.filter((hook) => hook.events?.includes(event) === true).map((hook) => hook.name);
}

/**
 * Quanto `postToWebhook` espera: o prazo gravado no webhook; sem ele, o de `net` (teste) ou o padrão.
 */
export function webhookTimeoutMs(hook: Pick<RegisteredWebhook, "timeoutSeconds">, net: Pick<SafeFetchOptions, "timeoutMs"> = {}): number {
  if (hook.timeoutSeconds !== undefined) return hook.timeoutSeconds * 1000;
  return net.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_SECONDS * 1000;
}

/**
 * `idempotencyKey`: vai no cabeçalho `Idempotency-Key`. Só evita duplicar se o sistema do outro
 * lado respeitar o cabeçalho; quem não conhece o ignora.
 */
export function postToWebhook(hook: RegisteredWebhook, payload: unknown, net: SafeFetchOptions = {}, idempotencyKey?: string): Promise<SafeResponse> {
  return safeFetch(
    hook.url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(hook.token !== undefined && { Authorization: `Bearer ${hook.token}` }),
        ...(idempotencyKey !== undefined && { "Idempotency-Key": idempotencyKey }),
      },
      body: JSON.stringify(payload),
    },
    { ...net, timeoutMs: webhookTimeoutMs(hook, net) },
  );
}
