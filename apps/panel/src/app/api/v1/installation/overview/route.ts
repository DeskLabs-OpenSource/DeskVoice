import { callCount, costTotal, listOrganizations, organizationDays, organizationLimits, organizationQueue, withOrg } from "@deskvoice/core";
import { ApiError } from "../../../../../server/context";
import { centsOf } from "../../../../../server/costs";
import { readEngineKeys } from "../../../../../server/engine-key";
import { engineLine, trunkLine, type HealthCheck } from "../../../../../server/health";
import { organizationTrunks, voiceHealthSchema, voiceRequest, type VoiceHealth } from "../../../../../server/voice";
import { handleInstallation } from "../handle";

/** O motor desta fatia: chave própria, nenhuma chave, ou uma chave cujo último teste falhou. */
export type OverviewEngine = "own_key" | "no_key" | "key_failed";

/**
 * A visão geral da instalação (seção 3.7 do desenho do R8): uma linha por organização, com os
 * números que a tela de cada uma mostra. A lista de organizações é a única leitura que atravessa;
 * cada número vem de um `withOrg` da própria organização, pelas mesmas funções da tela dela: o custo
 * por `costTotal` (Custos), a linha por `organizationTrunks` e `trunkLine` e o motor por
 * `readEngineKeys` e `engineLine` (Saúde). O teto do mês (fatia 7c) vem de `organization_limits` e é
 * comparado com o mesmo custo do mês. Fora desta fatia: a chave da instalação (8).
 *
 * A linha conta em três: `connected` (`ok`), `attention` (`warn`: carregada sem conferir, ou o
 * conjunto de endereços pede atenção) e `down` (só `fail`). A linha em aviso não caiu.
 *
 * O processo de voz é chamado uma vez por pedido. Se ele não responder, `trunk` vem nulo em toda
 * organização, e a tela diz que ele não respondeu, nunca "0 caídas".
 */
export const GET = handleInstallation({ support: false }, async ({ deps }) => {
  const now = deps.clock.now();
  let voice: VoiceHealth | null = null;
  try {
    voice = await voiceRequest(deps, "GET", "/health", voiceHealthSchema);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
  const organizations = [];
  // Em série: uma transação curta por organização.
  for (const organization of await listOrganizations(deps.db)) {
    organizations.push(
      await withOrg(deps.db, organization.id, async (q) => {
        const days = await organizationDays(q, now);
        const month = { from: days.monthStart, to: days.today };
        const cost = await costTotal(q, month);
        const last30 = { from: days.last30From, to: days.today };
        const trunks = voice ? await organizationTrunks(q, voice) : null;
        const engine = engineLine(await readEngineKeys(q));
        return {
          id: organization.id,
          name: organization.name,
          suspendedAt: organization.suspendedAt,
          calls: { ...last30, count: await callCount(q, last30) },
          cost: { ...month, cents: centsOf(cost.microcents), unmeasuredCount: cost.unmeasuredCount, estimatedCount: cost.estimatedCount },
          spendCapCents: (await organizationLimits(q)).monthlySpendCapCents,
          trunk: trunks && {
            connected: trunks.trunks.filter((line) => line.status === "ok").length,
            attention: trunks.trunks.filter((line) => line.status === "warn").length,
            down: trunks.trunks.filter((line) => line.status === "fail").length,
            check: trunkLine(trunks),
          },
          engine: { state: engineState(engine), check: engine },
          queue: await organizationQueue(q, now),
        };
      }),
    );
  }
  return { voiceAnswered: voice !== null, organizations };
});

function engineState(line: HealthCheck): OverviewEngine {
  if (line.reason === "engine_none") return "no_key";
  return line.status === "fail" ? "key_failed" : "own_key";
}
