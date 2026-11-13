import { z } from "zod";

/**
 * Cliente do WAHA, o serviço da própria instalação que mantém a sessão do WhatsApp lido por
 * QR Code (github.com/devlikeapro/waha, Apache-2.0).
 *
 * O endereço é fixo: o WAHA só existe na rede interna do Compose. Por isso este cliente não passa
 * pelo `safeFetch` (que recusa rede interna) e, pelo mesmo motivo, o endereço NUNCA vem de
 * configuração do operador: uma URL digitada aqui faria o processo mandar a chave da instalação
 * para onde o operador quisesse. `baseUrl` existe só para o teste apontar para um servidor falso.
 *
 * Contrato conferido na documentação do WAHA em 11/11/2026 (versão 2026.10.1). O formato da
 * resposta do `sendText` não está documentado: aqui só se exige que seja um objeto JSON.
 */
export const WAHA_URL = "http://waha:3000";
const TIMEOUT_MS = 10_000;

export const WAHA_SESSION_STATUSES = ["STOPPED", "STARTING", "SCAN_QR_CODE", "WORKING", "FAILED"] as const;
export type WahaSessionStatus = (typeof WAHA_SESSION_STATUSES)[number];

export type WahaErrorCode =
  /** A instalação não tem a chave do WAHA (versão anterior ao serviço, ou ambiente de desenvolvimento). */
  | "not_configured"
  /** O WAHA recusou a chave. */
  | "unauthorized"
  | "session_not_found"
  /** A sessão existe, mas não está conectada. */
  | "session_not_working"
  | "number_not_on_whatsapp"
  | "timeout"
  | "unreachable"
  /** O WAHA respondeu com um código HTTP de erro que não tem tradução acima. */
  | "rejected"
  /** A resposta não é o que a documentação promete. */
  | "invalid_response";

export class WahaError extends Error {
  override name = "WahaError";
  constructor(
    readonly code: WahaErrorCode,
    message: string,
    /** Código HTTP, quando a falha foi uma resposta do WAHA. */
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface WahaOptions {
  /** Texto puro, como o instalador gerou. O contêiner do WAHA só conhece o hash. */
  apiKey: string;
  /** Só para teste. Em produção vale `WAHA_URL`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface WahaSession {
  status: WahaSessionStatus;
  /** Número conectado, em E.164, quando a sessão está autenticada. */
  phone: string | null;
}

/** A chave que o instalador entregou a este processo. Vazia = o WhatsApp por QR Code não existe aqui. */
export const wahaFromEnv = (): WahaOptions => ({ apiKey: process.env.WAHA_API_KEY ?? "" });

/** Nome da sessão no WAHA: sai só do id da organização, sem nome nem telefone de ninguém. */
export const wahaSessionName = (organizationId: string): string => `dv_${organizationId.replaceAll("-", "")}`;

// Conversas que o DeskVoice não lê: sem isto o WAHA processaria e guardaria estados, grupos,
// canais e listas de difusão do número conectado.
const IGNORE = { status: true, groups: true, channels: true, broadcast: true } as const;

const sessionSchema = z.object({
  status: z.enum(WAHA_SESSION_STATUSES),
  me: z.object({ id: z.string() }).nullish(),
  config: z.record(z.string(), z.unknown()).nullish(),
});
const qrSchema = z.object({ mimetype: z.literal("image/png"), data: z.string().regex(/^[A-Za-z0-9+/]+=*$/) });
const existsSchema = z.object({ numberExists: z.boolean(), chatId: z.string().min(1).nullish() });
const anyObject = z.record(z.string(), z.unknown());

/** `5531999998888@c.us` → `+5531999998888`. Id que não é telefone (`@lid`) vale como desconhecido. */
function phoneOf(id: string | undefined): string | null {
  const match = /^(\d{8,15})(?::\d+)?@(?:c\.us|s\.whatsapp\.net)$/.exec(id ?? "");
  return match ? `+${match[1]}` : null;
}

interface Call {
  method?: string;
  body?: unknown;
  /** Códigos HTTP de erro que, nesta chamada, significam "já está assim". */
  tolerate?: number[];
}

async function call<T>(options: WahaOptions, path: string, schema: z.ZodType<T>, { method = "GET", body, tolerate = [] }: Call = {}): Promise<T | null> {
  if (!options.apiKey) throw new WahaError("not_configured", "This installation has no WAHA key (WAHA_API_KEY): WhatsApp by QR code is not available");
  let response: Response;
  let text: string;
  try {
    response = await (options.fetch ?? fetch)(`${options.baseUrl ?? WAHA_URL}${path}`, {
      method,
      headers: { "X-Api-Key": options.apiKey, Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      // A chave não acompanha redirecionamento nenhum: o WAHA não redireciona.
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw timedOut ? new WahaError("timeout", `WAHA did not answer ${method} ${path} in time`) : new WahaError("unreachable", `Could not reach WAHA (${method} ${path})`);
  }
  if (tolerate.includes(response.status)) return null;
  if (response.status === 401) throw new WahaError("unauthorized", "WAHA refused the installation key", 401);
  if (response.status === 404) throw new WahaError("session_not_found", `WAHA has no such session (${method} ${path})`, 404);
  if (!response.ok) throw new WahaError("rejected", `WAHA answered HTTP ${response.status} to ${method} ${path}`, response.status);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new WahaError("invalid_response", `WAHA answered ${method} ${path} with something that is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new WahaError("invalid_response", `WAHA answered ${method} ${path} outside the documented contract`);
  return parsed.data;
}

const sessionPath = (name: string): string => `/api/sessions/${encodeURIComponent(name)}`;
// Iniciar o que já roda e parar o que já parou respondem 409 ou 422 em algumas versões (medido no
// DeskcommCRM); quem chama quer o estado, não a transição.
const ALREADY = [409, 422];

/** Estado da sessão, ou `null` se o WAHA não a conhece. */
export async function wahaGetSession(options: WahaOptions, name: string): Promise<WahaSession | null> {
  const session = await call(options, sessionPath(name), sessionSchema, { tolerate: [404] });
  return session ? { status: session.status, phone: phoneOf(session.me?.id) } : null;
}

/**
 * Deixa a sessão criada (parada) e com a configuração esperada. Em sessão que já existe, lê antes
 * de escrever: o `PUT` do WAHA substitui a configuração inteira, então o que já está lá é mantido.
 */
export async function wahaEnsureSession(options: WahaOptions, name: string): Promise<void> {
  const current = await call(options, sessionPath(name), sessionSchema, { tolerate: [404] });
  if (!current) {
    // `start: false`: algumas versões ignoram `start: true`; iniciar é sempre a chamada seguinte.
    await call(options, "/api/sessions", anyObject, { method: "POST", body: { name, start: false, config: { ignore: IGNORE } } });
    return;
  }
  const ignore = anyObject.safeParse(current.config?.ignore);
  if (ignore.success && Object.entries(IGNORE).every(([key, value]) => ignore.data[key] === value)) return;
  await call(options, sessionPath(name), anyObject, { method: "PUT", body: { config: { ...current.config, ignore: IGNORE } } });
}

export async function wahaStartSession(options: WahaOptions, name: string): Promise<void> {
  await call(options, `${sessionPath(name)}/start`, anyObject, { method: "POST", body: {}, tolerate: ALREADY });
}

/** Para a sessão sem apagar o pareamento. Sessão que não existe já está parada. */
export async function wahaStopSession(options: WahaOptions, name: string): Promise<void> {
  await call(options, `${sessionPath(name)}/stop`, anyObject, { method: "POST", body: {}, tolerate: [404, ...ALREADY] });
}

/** Apaga o pareamento. Com a sessão conectada, o aparelho também some de "Dispositivos conectados". */
export async function wahaLogoutSession(options: WahaOptions, name: string): Promise<void> {
  await call(options, `${sessionPath(name)}/logout`, anyObject, { method: "POST", body: {}, tolerate: [404, ...ALREADY] });
}

/** O QR Code atual, como imagem PNG em base64. Só existe com a sessão em `SCAN_QR_CODE`. */
export async function wahaGetQr(options: WahaOptions, name: string): Promise<string> {
  const qr = await call(options, `/api/${encodeURIComponent(name)}/auth/qr`, qrSchema);
  if (!qr) throw new WahaError("invalid_response", "WAHA answered the QR code request with nothing");
  return qr.data;
}

/**
 * O endereço canônico do número no WhatsApp, ou `null` se ele não tem WhatsApp. É este endereço
 * que recebe a mensagem: no Brasil, o número com o nono dígito nem sempre é o que o WhatsApp usa.
 */
export async function wahaCheckExists(options: WahaOptions, name: string, e164: string): Promise<string | null> {
  const query = new URLSearchParams({ phone: e164.replace(/\D/g, ""), session: name });
  const result = await call(options, `/api/contacts/check-exists?${query.toString()}`, existsSchema);
  if (!result?.numberExists) return null;
  if (!result.chatId) throw new WahaError("invalid_response", "WAHA said the number exists and did not give its address");
  return result.chatId;
}

export async function wahaSendText(options: WahaOptions, name: string, chatId: string, text: string): Promise<void> {
  await call(options, "/api/sendText", anyObject, { method: "POST", body: { session: name, chatId, text } });
}

/**
 * Envia um texto pelo número conectado. Não tenta reconectar: sessão fora de `WORKING` é falha
 * com o estado no motivo, e número sem WhatsApp é falha antes de qualquer envio.
 *
 * A consulta do endereço canônico não pode derrubar todo envio. Se o WAHA recusar a rota em si
 * (ela não existe nesta versão, ou pede um recurso que a sessão não tem ligado), a mensagem vai
 * para o número como ele é, e quem chama fica sabendo por `addressVerified: false`. Chave
 * recusada, WAHA fora do ar e resposta fora do contrato continuam sendo falha.
 */
export async function sendViaWaha(options: WahaOptions, name: string, message: { to: string; text: string }): Promise<{ addressVerified: boolean }> {
  const session = await wahaGetSession(options, name);
  if (session?.status !== "WORKING") {
    throw new WahaError("session_not_working", `The WhatsApp number of this installation is not connected (session is ${session?.status ?? "missing"}): connect it in Settings → WhatsApp`);
  }
  let chatId: string | null;
  let addressVerified = true;
  try {
    chatId = await wahaCheckExists(options, name, message.to);
  } catch (error) {
    // 404 aqui é a rota: a sessão acabou de responder que existe e está conectada.
    if (!(error instanceof WahaError && (error.code === "rejected" || error.code === "session_not_found"))) throw error;
    chatId = `${message.to.replace(/\D/g, "")}@c.us`;
    addressVerified = false;
  }
  if (chatId === null) throw new WahaError("number_not_on_whatsapp", `${message.to} is not on WhatsApp`);
  await wahaSendText(options, name, chatId, message.text);
  return { addressVerified };
}
