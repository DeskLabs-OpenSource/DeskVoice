import { decryptSecret, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { safeFetch, type SafeFetchOptions, type SafeResponse } from "../net/safe-fetch";
import { readSetting } from "../settings";

export const ALLOWED_WEBHOOKS_KEY = "webhooks.allowed";

// Como fica em `settings`: `token`, quando existe, cifrado com `encryptSecret`.
const stored = z.array(z.object({ name: z.string().min(1), url: z.url(), token: z.string().min(1).optional() }));

export interface RegisteredWebhook {
  name: string;
  url: string;
  /** Já decifrado. */
  token?: string;
}

/** Os webhooks que o operador cadastrou. São os únicos destinos que o produto chama. */
export async function loadAllowedWebhooks(q: OrgQuery, secretKey: Buffer): Promise<RegisteredWebhook[]> {
  const value = await readSetting(q, ALLOWED_WEBHOOKS_KEY);
  if (value === null) return [];
  const parsed = stored.safeParse(value);
  if (!parsed.success) throw new Error(`Setting ${ALLOWED_WEBHOOKS_KEY} is malformed: expected [{ name, url, token? }]`);
  return parsed.data.map((hook) => ({ ...hook, token: hook.token === undefined ? undefined : decryptSecret(hook.token, secretKey) }));
}

export function postToWebhook(hook: RegisteredWebhook, payload: unknown, net: SafeFetchOptions = {}): Promise<SafeResponse> {
  return safeFetch(
    hook.url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(hook.token !== undefined && { Authorization: `Bearer ${hook.token}` }) },
      body: JSON.stringify(payload),
    },
    net,
  );
}
