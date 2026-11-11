import { encryptSecret } from "@deskvoice/core";
import { z, type ZodType } from "zod";
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
  /** Valida a entrada (lança `ZodError`) e devolve o que gravar. */
  store(input: unknown, key: Buffer, previous: unknown): unknown;
  view(stored: unknown): unknown;
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
const storedToken = z.object({ token: z.string() });
const storedHooks = z.array(z.object({ name: z.string(), url: z.string(), token: z.string().optional() }));

// Token em branco numa alteração mantém o que já estava gravado: a tela nunca recebe o valor
// para devolver, então "não mexi" precisa ser representável.
const connector = setting<{ type: "deskcomm" | "webhook"; url: string; token?: string }>({
  schema: z.object({ type: z.enum(["deskcomm", "webhook"]), url: httpUrl, token: z.string().trim().min(1).max(500).optional() }),
  secret: true,
  store(value, key, previous) {
    const kept = storedToken.safeParse(previous);
    const token = value.token ? encryptSecret(value.token, key) : kept.success ? kept.data.token : undefined;
    if (token === undefined) throw new z.ZodError([{ code: "custom", path: ["token"], message: "is required", input: undefined }]);
    return { type: value.type, url: value.url, token };
  },
  view(stored) {
    const parsed = z.object({ type: z.string(), url: z.string() }).safeParse(stored);
    return parsed.success ? { type: parsed.data.type, url: parsed.data.url, token: CONFIGURED } : null;
  },
});

const webhooks = setting<Array<{ name: string; url: string; token?: string }>>({
  schema: z
    .array(z.object({ name: z.string().trim().min(1).max(60), url: httpUrl, token: z.string().trim().min(1).max(500).optional() }))
    .max(50)
    .refine((hooks) => new Set(hooks.map((hook) => hook.name)).size === hooks.length, "webhook names must be unique"),
  secret: true,
  store(value, key, previous) {
    const kept = storedHooks.safeParse(previous);
    const before = new Map((kept.success ? kept.data : []).map((hook) => [hook.name, hook.token]));
    return value.map((hook) => {
      const token = hook.token ? encryptSecret(hook.token, key) : before.get(hook.name);
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
    "webhooks.allowed": webhooks,
    "recording_notice.text": plain(z.string().trim().min(1).max(500)),
    "network.public_ip": plain(z.ipv4()),
  };
  // Uma chave por motor que pede chave: motor novo na pasta ganha a configuração sem editar aqui.
  for (const engine of engines) if (!engine.keyless) definitions[engineKeySetting(engine.id)] = secretText;
  return Object.hasOwn(definitions, key) ? definitions[key] : undefined;
}
