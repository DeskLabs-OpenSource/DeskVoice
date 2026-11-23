import { analysisStatus, toAnalysisDraft, type AnalysisStatus, type BrainModelOption, type BrainOption } from "../../../../../(app)/agents/[id]/analysis-choice";
import { handle, notFound } from "../../../../../../server/context";
import { brainKeyCheckSetting, brainKeySetting, brainModelsSetting, listBrains, readBrainKeyCheck, readBrainModels } from "../../../../../../server/brains";

/**
 * De quem lê as ligações do agente, o que qualquer papel da organização pode ver (R4, ajuste da fatia
 * 5b): a escolha, o rótulo do cérebro e os avisos. Os avisos saem de `analysisStatus`, a mesma regra
 * (`analysisView`) da tela de quem configura, com o que `GET /brains` e `GET /brains/{brain}/models`
 * leem: da chave, só se existe e o resultado do teste; a lista de modelos guardada, sem reler o
 * provedor (a leitura não chama fora nem conta no limite de leituras). Não sai a chave, o teste cru,
 * a lista nem outro agente.
 */
export const GET = handle({}, async ({ q, params }): Promise<AnalysisStatus> => {
  const agent = await q.one<{ analysisBrain: unknown }>(`select analysis_brain as "analysisBrain" from agents where id = $1`, [params.id]);
  if (!agent) throw notFound();
  const analysis = toAnalysisDraft(agent.analysisBrain);
  if (analysis.kind !== "brain") return analysisStatus({ analysis, brains: undefined, models: undefined });

  // O valor da chave nunca é lido: a coluna secreta sai nula, como em `GET /brains`.
  const rows = await q.many<{ key: string; value: unknown }>("select key, case when secret then null else value end as value from settings where key like 'brain.%'");
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const discovered = await listBrains();
  const brains: BrainOption[] = discovered.map((brain) => ({
    id: brain.id,
    label: brain.label,
    configured: byKey.has(brainKeySetting(brain.id)),
    keyCheck: readBrainKeyCheck(byKey.get(brainKeyCheckSetting(brain.id))),
  }));
  // Como `GET /brains/{brain}/models`: cérebro não descoberto não tem lista (404); sem lista guardada, vazia.
  const models: BrainModelOption[] | undefined = discovered.some((brain) => brain.id === analysis.brain)
    ? (readBrainModels(byKey.get(brainModelsSetting(analysis.brain)))?.models ?? [])
    : undefined;
  return analysisStatus({ analysis, brains, models });
});
