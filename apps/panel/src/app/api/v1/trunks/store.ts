import { z } from "zod";
import { ApiError, type ServerDeps } from "../../../../server/context";
import { anything, voiceRequest } from "../../../../server/voice";

const applyAnswer = z.object({ applied: z.boolean(), detail: z.string() });

/**
 * Endereço extra de entrada e destino de saída só existem na linha reconhecida por IP; no modo
 * registro o provedor acha a linha pelo usuário e pela senha, e o campo extra não teria efeito.
 * Recusar na hora de salvar é melhor do que salvar e deixar a linha de fora da configuração.
 */
export function requireIpModeForAddresses(authMode: string, matchExtra: number, outboundHost: string | null): void {
  if (authMode !== "ip" && (matchExtra > 0 || outboundHost !== null)) {
    throw new ApiError(400, "validation_error", "Extra inbound addresses and an outbound address belong to a line recognized by IP; with registration the provider finds the line by the user and password.");
  }
}

/**
 * Pede ao processo de voz que regenere a configuração do Asterisk a partir do banco. Se ele não
 * responder, a linha fica salva mesmo assim e a tela avisa que falta aplicar.
 *
 * O processo de voz responde 200 também quando o Asterisk não carregou as linhas: quem diz se
 * carregou é o corpo. Resposta que não dá para ler conta como "não aplicado", nunca como sucesso.
 */
export async function applyTrunks(deps: ServerDeps, organizationId: string): Promise<{ applied: boolean; detail: string }> {
  try {
    const answer = applyAnswer.safeParse(await voiceRequest(deps, "POST", "/trunks/apply", anything, { organizationId }));
    if (!answer.success) return { applied: false, detail: "The voice process answered in a format the panel does not understand, so the lines were not confirmed." };
    return { applied: answer.data.applied, detail: answer.data.detail };
  } catch (error) {
    if (error instanceof ApiError) return { applied: false, detail: error.message };
    throw error;
  }
}
