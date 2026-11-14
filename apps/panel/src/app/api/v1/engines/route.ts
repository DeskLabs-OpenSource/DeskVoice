import { classifyBaseUrlOf, classifyModelOf, engineBaseUrlSetting, engineClassifyModelSetting } from "@deskvoice/voice-engine/types";
import { handle } from "../../../../server/context";
import { keyCheckSetting, readKeyCheck } from "../../../../server/engine-key";
import { engineKeySetting, listEngines } from "../../../../server/pieces";

export const GET = handle({}, async ({ q }) => {
  const rows = await q.many<{ key: string; value: unknown }>("select key, case when secret then null else value end as value from settings where key like 'engine.%'");
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return (await listEngines()).map((engine) => ({
    id: engine.id,
    label: engine.label,
    provider: engine.provider,
    processingLocation: engine.processingLocation,
    requiresKey: !engine.keyless,
    // Só o motor que declara aceita endpoint e modelo próprios na classificação; a tela mostra os
    // campos só para ele.
    classifyTarget: engine.classifyTarget === true,
    baseUrl: classifyBaseUrlOf(byKey.get(engineBaseUrlSetting(engine.id))) ?? null,
    classifyModel: classifyModelOf(byKey.get(engineClassifyModelSetting(engine.id))) ?? null,
    voices: engine.voices ?? [],
    defaultVoice: engine.defaultVoice ?? null,
    keyConfigured: byKey.has(engineKeySetting(engine.id)),
    keyCheck: readKeyCheck(byKey.get(keyCheckSetting(engine.id))),
    priceCheckedOn: engine.pricing.checkedOn,
    priceSource: engine.pricing.source,
  }));
});
