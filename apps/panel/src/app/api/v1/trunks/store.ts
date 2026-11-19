import { trunkOverlapWarning } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, type ServerDeps } from "../../../../server/context";
import { inboundAddressProblem } from "../../../../server/trunk-host";
import { anything, voiceRequest } from "../../../../server/voice";

const applyAnswer = z.object({ applied: z.boolean(), detail: z.string() });

/**
 * O destino de saída só existe na linha reconhecida por IP; no modo registro a ligação sai pelo
 * servidor do registro. Recusar na hora de salvar é melhor do que salvar e deixar a linha de fora
 * da configuração. Os endereços extras de entrada valem nos dois modos: na linha por registro eles
 * liberam a entrada da operadora que registra por um servidor e entrega por outro (R14).
 */
export function requireIpModeForAddresses(authMode: string, outboundHost: string | null): void {
  if (authMode !== "ip" && outboundHost !== null) {
    throw new ApiError(400, "validation_error", "An outbound address belongs to a line recognized by IP; with registration the calls go out to the server the line registers with.");
  }
}

/**
 * Os outros endereços de entrada são só numéricos (decisão 0007), nos dois modos: nome fica para o
 * endereço de saída. Na linha reconhecida por IP o endereço do servidor também. E bloco largo
 * demais é recusado. A mensagem diz qual campo, sem repetir o valor.
 */
export function requireNumericInbound(authMode: string, host: string, matchExtra: readonly string[]): void {
  const where = authMode === "ip" ? "In a line recognized by IP" : "In a line that registers";
  for (const [index, value] of [host, ...matchExtra].entries()) {
    // Na linha por registro o servidor pode ser nome: só os extras passam pela regra.
    if (index === 0 && authMode !== "ip") continue;
    const problem = inboundAddressProblem(value);
    if (problem === null) continue;
    const field = index === 0 ? "the provider server address" : `the other inbound address ${index}`;
    if (problem === "name") throw new ApiError(400, "trunk_inbound_name", `${where}, ${field} must be an IP or an address block, not a name.`);
    throw new ApiError(400, "trunk_block_too_wide", `${where}, ${field} is a block wider than /16 (IPv4) or /32 (IPv6).`);
  }
}

/**
 * Antes de gravar, o aviso de faixa sobreposta (R8, fatia 10): se a linha tiraria do ar uma linha
 * por IP (desta ou de outra organização) que hoje está no ar, a gravação para e a tela pergunta.
 * A resposta não diz qual linha, de quem nem em que endereço: só que existe uma. Com a confirmação,
 * salva como sempre. Quem chama só confere quando o endereço, os extras ou o modo mudam.
 */
export async function requireOverlapConfirmed(
  deps: ServerDeps,
  organizationId: string,
  candidate: { id?: string; host: string; authMode: "register" | "ip"; matchExtra?: readonly string[] | null },
  confirmed: boolean | undefined,
): Promise<void> {
  if (confirmed === true) return;
  if ((await trunkOverlapWarning(deps.db, organizationId, candidate)).stops) {
    throw new ApiError(
      409,
      "trunk_overlap_unconfirmed",
      "Another organization of this installation has a line in a range that overlaps this one. If you save, the lines recognized by IP of both stop receiving calls until one of them changes its address.",
    );
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
