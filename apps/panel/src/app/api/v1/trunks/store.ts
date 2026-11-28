import { recordTrunkOverlap, trunkOverlapWarning, type TrunkCandidate } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, type ServerDeps, type Session } from "../../../../server/context";
import { createRateLimiter } from "../../../../server/rate-limit";
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
 * Quantas conferências de faixa cada organização faz por minuto. Cada conferência gasta uma
 * tentativa, com resposta sim ou não. Em memória, como o limite do login (`rate-limit.ts`).
 */
export const TRUNK_OVERLAP_CHECKS_PER_MINUTE = 10;
export const trunkOverlapLimiter = createRateLimiter(TRUNK_OVERLAP_CHECKS_PER_MINUTE, 60 * 1000);

/**
 * Acima de quantas conferências de faixa no dia a organização aparece na auditoria da instalação
 * (`trunk_overlap_many_checks`). Quem monta linhas de verdade confere poucas vezes por dia. O
 * número está também na frase da auditoria, nos três idiomas.
 */
export const TRUNK_OVERLAP_CHECKS_BEFORE_AUDIT = 20;

/**
 * Quantas conferências cada organização fez no dia (UTC), contando sim e não, com ou sem
 * confirmação. Em memória, como o limite por minuto: reiniciar o painel zera a conta. Uma chave por
 * organização, trocada quando o dia muda.
 */
export function createDailyCounter() {
  const counts = new Map<string, { day: string; count: number }>();
  return {
    /** Soma 1 à conta do dia de `key` e devolve a conta nova. */
    add(key: string, now: Date): number {
      const day = now.toISOString().slice(0, 10);
      const current = counts.get(key);
      const count = current?.day === day ? current.count + 1 : 1;
      counts.set(key, { day, count });
      return count;
    },
    clear(): void {
      counts.clear();
    },
  };
}
export const trunkOverlapDailyChecks = createDailyCounter();

/**
 * Antes de gravar, o aviso de faixa sobreposta (R8, fatia 10): se a linha tiraria do ar uma linha
 * por IP (desta ou de outra organização) que hoje está no ar, a gravação para e a tela pergunta.
 * A resposta não diz qual linha, de quem nem em que endereço: só que existe uma. Com a confirmação,
 * salva, mas confere do mesmo jeito: a confirmação é só um campo do pedido, e a rota não confia que
 * ela veio depois do aviso. A criação sempre confere; a edição, quando a linha passa a entrar no
 * agrupamento ou, já dentro dele, muda o endereço, os extras ou o modo (`trunkEntersGroups`).
 *
 * Cada conferência, com ou sem confirmação, gasta uma tentativa do limite da organização; acima
 * dele, 429 sem conferir e sem salvar. Na auditoria da instalação, fora da transação da linha:
 *   - a conferência que passa de `TRUNK_OVERLAP_CHECKS_BEFORE_AUDIT` no dia grava
 *     `trunk_overlap_many_checks`, só ela, uma vez por dia, com qualquer resposta (a resposta
 *     "não" não grava outro evento);
 *   - a recusa grava `trunk_overlap_refused`, e o evento fica mesmo com a resposta 409;
 *   - a confirmação que tira linha do ar grava `trunk_overlap_confirmed`, antes de salvar. Por isso
 *     quem chama confere por último, depois de toda outra recusa: o evento diz que a gravação seguiu.
 */
export async function requireOverlapConfirmed(
  deps: ServerDeps,
  organizationId: string,
  session: Session,
  candidate: TrunkCandidate,
  confirmed: boolean | undefined,
): Promise<void> {
  const now = deps.clock.now();
  if (!trunkOverlapLimiter.take(organizationId, now)) {
    throw new ApiError(429, "too_many_attempts", "Too many attempts. Wait a minute and try again.");
  }
  if (trunkOverlapDailyChecks.add(organizationId, now) === TRUNK_OVERLAP_CHECKS_BEFORE_AUDIT + 1) {
    await recordTrunkOverlap(deps.db, now, "trunk_overlap_many_checks", organizationId, session.userId);
  }
  if (!(await trunkOverlapWarning(deps.db, deps.secretKey, organizationId, candidate)).stops) return;
  if (confirmed === true) {
    await recordTrunkOverlap(deps.db, now, "trunk_overlap_confirmed", organizationId, session.userId);
    return;
  }
  await recordTrunkOverlap(deps.db, now, "trunk_overlap_refused", organizationId, session.userId);
  throw new ApiError(
    409,
    "trunk_overlap_unconfirmed",
    "Another organization of this installation has a line in a range that overlaps this one. If you save, the lines recognized by IP of both stop receiving calls until one of them changes its address.",
  );
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
