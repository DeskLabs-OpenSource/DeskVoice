import { z, type ZodType } from "zod";
import { ApiError, type ServerDeps } from "./context";

const status = z.enum(["ok", "warn", "fail"]);
export const voiceHealthSchema = z.object({
  asterisk: z.object({ status, detail: z.string() }),
  trunks: z.array(z.object({ id: z.string(), status, detail: z.string() })),
});
export type VoiceHealth = z.infer<typeof voiceHealthSchema>;
export const callIdSchema = z.object({ callId: z.string() });
export const anything = z.unknown();

const refusal = z.object({ code: z.string(), message: z.string() });
const TIMEOUT_MS = 5000;

/**
 * Fala com o processo de voz pela rede interna. Se ele não responde, o erro é `voice_unavailable`;
 * se ele recusa (política de saída, agente sem motor), o código da recusa segue até a tela.
 */
export async function voiceRequest<T>(deps: ServerDeps, method: "GET" | "POST", path: string, schema: ZodType<T>, body?: object): Promise<T> {
  let response: Response;
  let payload: unknown;
  try {
    response = await deps.fetch(`${deps.voiceUrl}${path}`, {
      method,
      headers: { "x-internal-token": deps.internalToken, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    payload = await response.json();
  } catch (error) {
    throw new ApiError(502, "voice_unavailable", `The voice process did not answer: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const refused = refusal.safeParse(payload);
    if (refused.success) throw new ApiError(422, refused.data.code, refused.data.message);
    throw new ApiError(502, "voice_unavailable", `The voice process answered with status ${response.status}.`);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiError(502, "voice_unavailable", "The voice process sent an answer the panel does not understand.");
  return parsed.data;
}

export const webCallSchema = z.object({ callId: z.string(), token: z.string().min(1) });

/**
 * Onde o navegador conecta o áudio da chamada. Com proxy na frente (o padrão), é no mesmo
 * endereço do painel e o proxy encaminha `/voice-ws`. Sem proxy, o instalador grava em
 * `VOICE_WEB_PUBLIC_PORT` a porta em que o processo de voz foi publicado, no mesmo host.
 * Vazio, ausente ou qualquer coisa que não seja uma porta vale como "não definida".
 */
export function voiceSocketTarget(publicPort: string | undefined): { path: string } | { port: number } {
  const port = /^\d{1,5}$/.test(publicPort ?? "") ? Number(publicPort) : 0;
  return port >= 1 && port <= 65535 ? { port } : { path: "/voice-ws" };
}
