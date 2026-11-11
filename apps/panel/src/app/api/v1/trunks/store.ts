import { ApiError, type ServerDeps } from "../../../../server/context";
import { anything, voiceRequest } from "../../../../server/voice";

/**
 * Pede ao processo de voz que regenere a configuração do Asterisk a partir do banco. Se ele não
 * responder, a linha fica salva mesmo assim e a tela avisa que falta aplicar.
 */
export async function applyTrunks(deps: ServerDeps, organizationId: string): Promise<{ applied: boolean; detail: string }> {
  try {
    await voiceRequest(deps, "POST", "/trunks/apply", anything, { organizationId });
    return { applied: true, detail: "" };
  } catch (error) {
    if (error instanceof ApiError) return { applied: false, detail: error.message };
    throw error;
  }
}
