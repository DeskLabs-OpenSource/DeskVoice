import { z } from "zod";
import { ApiError, type ServerDeps } from "../../../../server/context";
import { inboundAddressProblem } from "../../../../server/trunk-host";
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
 * Na linha reconhecida por IP, o endereço do servidor e os outros endereços de entrada são só
 * numéricos (decisão 0007): nome fica para o endereço de saída. E o reconhecimento por IP recusa
 * bloco largo demais. A mensagem diz qual campo, sem repetir o valor.
 */
export function requireNumericInbound(authMode: string, host: string, matchExtra: readonly string[]): void {
  if (authMode !== "ip") return;
  for (const [index, value] of [host, ...matchExtra].entries()) {
    const problem = inboundAddressProblem(value);
    if (problem === null) continue;
    const field = index === 0 ? "the provider server address" : `the other inbound address ${index}`;
    if (problem === "name") throw new ApiError(400, "trunk_inbound_name", `In a line recognized by IP, ${field} must be an IP or an address block, not a name.`);
    throw new ApiError(400, "trunk_block_too_wide", `In a line recognized by IP, ${field} is a block wider than /16 (IPv4) or /32 (IPv6).`);
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
