import { handle } from "../../../../server/context";
import { brainKeyCheckSetting, brainKeySetting, brainModelsSetting, listBrains, readBrainKeyCheck, readBrainModels } from "../../../../server/brains";

/**
 * Os cérebros descobertos, com o estado da chave de cada um. Da chave, só se existe. `agents` são os
 * agentes que escolheram o cérebro para ler as ligações deles (só id e nome): a confirmação de remover
 * a chave diz qual análise para.
 */
export const GET = handle({ configure: true }, async ({ q }) => {
  const rows = await q.many<{ key: string; value: unknown }>("select key, case when secret then null else value end as value from settings where key like 'brain.%'");
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const choosers = await q.many<{ id: string; name: string; brain: string }>(
    "select id, name, analysis_brain->>'brain' as brain from agents where analysis_brain->>'kind' = 'brain' order by name, id",
  );
  return (await listBrains()).map((brain) => {
    const models = readBrainModels(byKey.get(brainModelsSetting(brain.id)));
    return {
      id: brain.id,
      label: brain.label,
      keyUrl: brain.keyUrl,
      // Só o cérebro com `chat` conversa numa ligação do pipeline (fatia 5b-1).
      chat: brain.chat !== undefined,
      configured: byKey.has(brainKeySetting(brain.id)),
      keyCheck: readBrainKeyCheck(byKey.get(brainKeyCheckSetting(brain.id))),
      modelCount: models?.models.length ?? null,
      fetchedAt: models?.fetchedAt ?? null,
      agents: choosers.filter((agent) => agent.brain === brain.id).map((agent) => ({ id: agent.id, name: agent.name })),
    };
  });
});
