import { DEFAULT_INBOUND_LIMIT, INBOUND_LIMIT_SETTING, encryptSecret, inboundLimitSchema } from "@deskvoice/core";
import { z, type ZodType } from "zod";
import type { VoiceEngine } from "@deskvoice/voice-engine";
import { ApiError } from "./context";
import { engineKeySetting, listEngines } from "./pieces";

/**
 * Uma configuração conhecida. `store` devolve o que vai para o banco (segredos já cifrados) e
 * `view` o que a API devolve: de um segredo, só `{ configured: true }`, nunca o valor.
 */
interface SettingDefinition<T> {
  schema: ZodType<T>;
  secret: boolean;
  store(value: T, key: Buffer, previous: unknown): unknown;
  view(stored: unknown): unknown;
}

export interface Setting {
  secret: boolean;
  /** O que vale sem nada gravado, quando a tela precisa mostrar o valor em vigor. */
  fallback?: unknown;
  /** Valida a entrada (lança `ZodError`) e devolve o que gravar. */
  store(input: unknown, key: Buffer, previous: unknown): unknown;
  view(stored: unknown): unknown;
  /** Recusa (lançando `ApiError`) trocar ou apagar o valor gravado por esta rota. */
  guard?(previous: unknown): void;
  /** A chave de um motor: ao gravar, ela é testada, e o teste da chave anterior deixa de valer. */
  engine?: VoiceEngine;
}

const setting = <T>(definition: SettingDefinition<T>): Setting => ({
  secret: definition.secret,
  store: (input, key, previous) => definition.store(definition.schema.parse(input), key, previous),
  view: definition.view,
});

const CONFIGURED = { configured: true };
const plain = <T>(schema: ZodType<T>): Setting => setting({ schema, secret: false, store: (value) => value, view: (stored) => stored });
const secretText = setting<string>({
  schema: z.string().trim().min(1).max(500),
  secret: true,
  store: (value, key) => encryptSecret(value, key),
  view: () => CONFIGURED,
});

const httpUrl = z.url({ protocol: /^https?$/ });
const storedConnector = z.object({ type: z.string(), url: z.string(), token: z.string() });
const storedHooks = z.array(z.object({ name: z.string(), url: z.string(), token: z.string().optional() }));

// Token em branco numa alteração mantém o que já estava gravado: a tela nunca recebe o valor
// para devolver, então "não mexi" precisa ser representável. Mas só para o MESMO destino: o token
// foi dado a um endereço, e mantê-lo ao trocar a URL o entregaria a quem responde no endereço novo.
// O tipo `waha` (número conectado por QR Code) não se grava nem se apaga por aqui: ele entra ao
// conectar e sai ao desconectar, em Configurações > WhatsApp. Trocar o conector por baixo deixaria
// um número pareado e sem uso, e a tela dizendo "conectado" enquanto o envio sai por outro lugar.
const isWaha = (stored: unknown): boolean => z.object({ type: z.literal("waha") }).safeParse(stored).success;
const connector: Setting = {
  guard(previous) {
    if (isWaha(previous)) throw new ApiError(409, "whatsapp_connected", "A WhatsApp number is connected by QR code: disconnect it before saving another connector.");
  },
  ...setting<{ type: "deskcomm" | "webhook"; url: string; token?: string }>({
  schema: z.object({ type: z.enum(["deskcomm", "webhook"]), url: httpUrl, token: z.string().trim().min(1).max(500).optional() }),
  secret: true,
  store(value, key, previous) {
    const kept = storedConnector.safeParse(previous);
    const sameDestination = kept.success && kept.data.type === value.type && kept.data.url === value.url;
    const token = value.token ? encryptSecret(value.token, key) : sameDestination ? kept.data.token : undefined;
    if (token === undefined) throw new ApiError(400, "token_required", "When the connector address or type changes, enter the token again.");
    return { type: value.type, url: value.url, token };
  },
  view(stored) {
    if (isWaha(stored)) return { type: "waha" };
    const parsed = z.object({ type: z.string(), url: z.string() }).safeParse(stored);
    return parsed.success ? { type: parsed.data.type, url: parsed.data.url, token: CONFIGURED } : null;
  },
  }),
};

const webhooks = setting<Array<{ name: string; url: string; token?: string }>>({
  schema: z
    .array(z.object({ name: z.string().trim().min(1).max(60), url: httpUrl, token: z.string().trim().min(1).max(500).optional() }))
    .max(50)
    .refine((hooks) => new Set(hooks.map((hook) => hook.name)).size === hooks.length, "webhook names must be unique"),
  secret: true,
  store(value, key, previous) {
    const kept = storedHooks.safeParse(previous);
    // Por item, com nome E endereço iguais. Endereço novo (ou item renomeado) sem token fica sem
    // token: é opcional aqui, e o antigo nunca é copiado para outro destino.
    const before = kept.success ? kept.data : [];
    return value.map((hook) => {
      const token = hook.token ? encryptSecret(hook.token, key) : before.find((old) => old.name === hook.name && old.url === hook.url)?.token;
      return { name: hook.name, url: hook.url, ...(token !== undefined && { token }) };
    });
  },
  view(stored) {
    const parsed = storedHooks.safeParse(stored);
    return (parsed.success ? parsed.data : []).map((hook) => ({ name: hook.name, url: hook.url, token: { configured: hook.token !== undefined } }));
  },
});

/** A definição da chave, ou `undefined` se a chave não for conhecida. Não existe configuração livre. */
export async function settingDefinition(key: string): Promise<Setting | undefined> {
  const engines = await listEngines();
  const definitions: Record<string, Setting> = {
    "engine.default": plain(z.string().refine((id) => engines.some((engine) => engine.id === id), "unknown voice engine")),
    "whatsapp.connector": connector,
    // Ausente vale `false`: o envio para quem ligou pede confirmação humana (o número exibido é forjável).
    "whatsapp.trust_caller_id": plain(z.boolean()),
    // Ausente vale `false`: o aviso de fim de ligação pelo WhatsApp nasce desligado.
    "whatsapp.notify_owner_on_call_end": plain(z.boolean()),
    "webhooks.allowed": webhooks,
    // O que vale quando ninguém responde a um pedido de aprovação. Ausente vale `denied`: é escolha
    // do operador, não do modelo de IA.
    "approvals.default_on_timeout": plain(z.enum(["denied", "approved"])),
    "recording_notice.text": plain(z.string().trim().min(1).max(500)),
    "network.public_ip": plain(z.ipv4()),
    // Ligações recebidas pela operadora ao mesmo tempo. Ausente vale o teto de fábrica.
    [INBOUND_LIMIT_SETTING]: { ...plain(inboundLimitSchema), fallback: DEFAULT_INBOUND_LIMIT },
  };
  // Uma chave por motor que pede chave: motor novo na pasta ganha a configuração sem editar aqui.
  for (const engine of engines) if (!engine.keyless) definitions[engineKeySetting(engine.id)] = { ...secretText, engine };
  return Object.hasOwn(definitions, key) ? definitions[key] : undefined;
}
