import { handle } from "../../../../server/context";
import { brainKeyCheckSetting, brainKeySetting, brainModelsSetting, listBrains, readBrainKeyCheck, readBrainModels } from "../../../../server/brains";

/** Os cérebros descobertos, com o estado da chave de cada um. Da chave, só se existe. */
export const GET = handle({ configure: true }, async ({ q }) => {
  const rows = await q.many<{ key: string; value: unknown }>("select key, case when secret then null else value end as value from settings where key like 'brain.%'");
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return (await listBrains()).map((brain) => {
    const models = readBrainModels(byKey.get(brainModelsSetting(brain.id)));
    return {
      id: brain.id,
      label: brain.label,
      keyUrl: brain.keyUrl,
      configured: byKey.has(brainKeySetting(brain.id)),
      keyCheck: readBrainKeyCheck(byKey.get(brainKeyCheckSetting(brain.id))),
      modelCount: models?.models.length ?? null,
      fetchedAt: models?.fetchedAt ?? null,
    };
  });
});
