import { engineClassifyTargetSetting } from "@deskvoice/voice-engine/types";
import { handle } from "../../../../server/context";
import { keyCheckSetting, readKeyCheck } from "../../../../server/engine-key";
import { engineKeySetting, listEngines } from "../../../../server/pieces";
import { pipelineUnavailable } from "../../../../server/pipeline";
import { classifyTargetView } from "../../../../server/settings";

export const GET = handle({}, async ({ q }) => {
  const rows = await q.many<{ key: string; value: unknown }>("select key, case when secret then null else value end as value from settings where key like 'engine.%'");
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  // O destino da classificação guarda a chave do endpoint e por isso é segredo: só sai daqui pela
  // vista, que diz se a chave existe e nunca o valor.
  const targets = await q.many<{ key: string; value: unknown }>("select key, value from settings where key like 'engine.%.classify_target'");
  const targetOf = (engineId: string) => classifyTargetView(targets.find((row) => row.key === engineClassifyTargetSetting(engineId))?.value);
  // O modelo gravado sem endpoint que a tabela de preço desta versão não tem: o motor usa o modelo
  // dele no lugar, e a tela precisa dizer isso, senão mostra como valendo um modelo que não vale
  // (issue 239). Hoje só acontece com configuração posta por fora do painel ou com um modelo que
  // saia da tabela numa versão futura.
  const unmeasured = (engine: { id: string; classifyPricing?(model: string): unknown }): boolean => {
    const { baseUrl, model } = targetOf(engine.id);
    return baseUrl === null && model !== null && engine.classifyPricing?.(model) === undefined;
  };
  const unavailable = await pipelineUnavailable();
  return (await listEngines()).map((engine) => ({
    id: engine.id,
    label: engine.label,
    provider: engine.provider,
    processingLocation: engine.processingLocation,
    requiresKey: !engine.keyless,
    // Só o motor que declara aceita endpoint e modelo próprios na classificação; a tela mostra os
    // campos só para ele. Da chave do endpoint, só se existe.
    classifyTarget: engine.classifyTarget === true,
    baseUrl: targetOf(engine.id).baseUrl,
    classifyModel: targetOf(engine.id).model,
    classifyModelUnmeasured: unmeasured(engine),
    classifyKeyConfigured: targetOf(engine.id).apiKey.configured,
    voices: engine.voices ?? [],
    defaultVoice: engine.defaultVoice ?? null,
    keyConfigured: byKey.has(engineKeySetting(engine.id)),
    keyCheck: readKeyCheck(byKey.get(keyCheckSetting(engine.id))),
    priceCheckedOn: engine.pricing.checkedOn,
    priceSource: engine.pricing.source,
    // O pipeline (fatia 5b-1): aparece na lista, desligado e com o motivo, e nunca é o motor de um
    // agente. Os outros motores saem como sempre, sem campo novo.
    ...(engine.assembled === true && { assembled: true, unavailable }),
  }));
});
