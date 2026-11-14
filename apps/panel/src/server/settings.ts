import { DEFAULT_INBOUND_LIMIT, INBOUND_LIMIT_SETTING, encryptSecret, inboundLimitSchema } from "@deskvoice/core";
import { z, type ZodType } from "zod";
import type { VoiceEngine } from "@deskvoice/voice-engine";
import { ANALYSIS_SETTING, OUTCOME_SETTING, TRANSCRIPTION_SETTING, classifyBaseUrlOf, classifyModelOf, engineClassifyTargetSetting, storedClassifyTargetOf } from "@deskvoice/voice-engine/types";
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

/** O destino da classificação como a tela o vê: da chave, só se existe. */
export function classifyTargetView(stored: unknown): { baseUrl: string | null; model: string | null; apiKey: { configured: boolean } } {
  const target = storedClassifyTargetOf(stored);
  return { baseUrl: classifyBaseUrlOf(target.baseUrl) ?? null, model: classifyModelOf(target.model) ?? null, apiKey: { configured: target.apiKey !== undefined } };
}

const httpUrl = z.url({ protocol: /^https?$/ });
const storedConnector = z.object({ type: z.string(), url: z.string(), token: z.string() });
const storedHooks = z.array(z.object({ name: z.string(), url: z.string(), token: z.string().optional() }));

// O destino da classificação: `https` e host público (o processo de rotinas alcança a rede interna),
// gravado sem a barra final, porque o caminho do provedor é colado depois. O modelo é o nome que o
// provedor publica. A mesma regra vale na leitura da rotina: endpoint gravado por fora do painel
// que não passe aqui não recebe pedido nenhum, e modelo que não passe fica no padrão do motor.
const classifyBaseUrlSchema = z
  .string()
  .max(500)
  .transform((value) => value.trim())
  .refine((value) => classifyBaseUrlOf(value) !== undefined, "must be a public https URL with no credentials")
  .transform((value) => value.replace(/\/+$/, ""));
const classifyModelSchema = z
  .string()
  .max(200)
  .transform((value) => value.trim())
  .refine((value) => classifyModelOf(value) !== undefined, "model names take letters, digits and . _ : / -");

// Endpoint, modelo e a chave do endpoint juntos, com a regra do conector abaixo: a chave foi dada
// a um endereço, então chave em branco só mantém a gravada se o endpoint for o mesmo; endpoint novo
// pede a chave de novo. A chave do motor nunca serve aqui. Sem endpoint não há chave: só o modelo,
// e a classificação segue na OpenAI com a chave do motor.
const classifyTarget = setting<{ baseUrl?: string; model?: string; apiKey?: string }>({
  schema: z.object({ baseUrl: classifyBaseUrlSchema.optional(), model: classifyModelSchema.optional(), apiKey: z.string().trim().min(1).max(500).optional() }),
  secret: true,
  store(value, key, previous) {
    if (value.baseUrl === undefined) {
      if (value.apiKey !== undefined) throw new ApiError(400, "endpoint_required", "The classification key belongs to an endpoint: enter the endpoint too.");
      return value.model === undefined ? {} : { model: value.model };
    }
    const kept = storedClassifyTargetOf(previous);
    const apiKey = value.apiKey ? encryptSecret(value.apiKey, key) : kept.baseUrl === value.baseUrl ? kept.apiKey : undefined;
    if (apiKey === undefined) throw new ApiError(400, "endpoint_key_required", "When the classification endpoint changes, enter its key again.");
    return { baseUrl: value.baseUrl, ...(value.model !== undefined && { model: value.model }), apiKey };
  },
  view: classifyTargetView,
});

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
    // Classificar o desfecho de cada ligação com o motor do agente. Ausente vale desligado: é uma
    // chamada paga ao provedor por ligação, e o dono decide.
    [OUTCOME_SETTING]: { ...plain(z.boolean()), fallback: false },
    // Analisar cada ligação no fim (nota pela régua, temperatura, objeções). Ausente vale desligado:
    // a análise vem na mesma chamada paga do desfecho, mais longa, e o dono decide.
    [ANALYSIS_SETTING]: { ...plain(z.boolean()), fallback: false },
    // Transcrever a gravação de uma chamada sem texto, a pedido. Ausente vale desligado: o áudio
    // gravado vai ao provedor do motor, e cada transcrição é paga.
    [TRANSCRIPTION_SETTING]: { ...plain(z.boolean()), fallback: false },
    "network.public_ip": plain(z.ipv4()),
    // Ligações recebidas pela operadora ao mesmo tempo. Ausente vale o teto de fábrica.
    [INBOUND_LIMIT_SETTING]: { ...plain(inboundLimitSchema), fallback: DEFAULT_INBOUND_LIMIT },
  };
  // Uma chave por motor que pede chave: motor novo na pasta ganha a configuração sem editar aqui.
  for (const engine of engines) if (!engine.keyless) definitions[engineKeySetting(engine.id)] = { ...secretText, engine };
  // Onde a classificação do desfecho acontece, por motor, para quem paga um provedor compatível com
  // OpenAI em vez da OpenAI. A voz em tempo real não muda. Ausente vale o endereço, o modelo e a
  // chave do motor, que é o de hoje: quem não configura nada não vê diferença no pedido.
  for (const engine of engines) if (!engine.keyless && engine.classifyTarget) definitions[engineClassifyTargetSetting(engine.id)] = classifyTarget;
  return Object.hasOwn(definitions, key) ? definitions[key] : undefined;
}
