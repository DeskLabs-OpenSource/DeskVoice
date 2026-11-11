import { handle } from "../../../../server/context";
import { engineKeySetting, listEngines } from "../../../../server/pieces";

export const GET = handle({}, async ({ q }) => {
  const keys = new Set((await q.many<{ key: string }>("select key from settings where secret and key like 'engine.%'")).map((row) => row.key));
  return (await listEngines()).map((engine) => ({
    id: engine.id,
    label: engine.label,
    requiresKey: !engine.keyless,
    keyConfigured: keys.has(engineKeySetting(engine.id)),
    priceCheckedOn: engine.pricing.checkedOn,
    priceSource: engine.pricing.source,
  }));
});
