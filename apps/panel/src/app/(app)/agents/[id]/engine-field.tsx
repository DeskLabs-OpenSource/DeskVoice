"use client";

import type { AgentsDictionary } from "../../../../i18n/pt-BR/agents";
import { Field, Select } from "../../../../ui/kit";
import { agentEngines, type Engine } from "../../../../ui/types";

/** A linha que diz por que o pipeline está desligado; o motivo que o dicionário não conhece cai na frase geral. */
export const pipelineOffLine = (t: AgentsDictionary, engine: Engine): string => (engine.unavailable ? t.enginePipelineOff[engine.unavailable.reason] : undefined) ?? t.enginePipelineOffUnknown;

/**
 * O motor com que o agente novo nasce: o padrão da instalação; sem padrão, o primeiro da lista. O
 * pipeline nunca é o motor de um agente (fatia 5b-1), nem o primeiro.
 */
export const newAgentEngine = (defaultId: string | null | undefined, engines: readonly Engine[] | undefined): string => defaultId ?? agentEngines(engines)[0]?.id ?? "";

/**
 * O campo "Motor de voz" (fatia 5b-1). Os motores de sempre ficam como estão. O pipeline aparece na
 * lista, desligado, com uma linha que diz o que falta: nesta fatia ninguém o escolhe como motor (a API
 * também recusa), e a escolha das peças fica no bloco "Pipeline", só para ver e ouvir.
 */
export function EngineField({ t, engines, value, onChange }: { t: AgentsDictionary; engines: readonly Engine[] | undefined; value: string; onChange(next: string): void }) {
  const assembled = engines?.filter((engine) => engine.assembled === true) ?? [];
  return (
    <div className="grid content-start gap-2">
      <Field label={t.engine}>
        <Select value={value} onChange={(event) => onChange(event.target.value)} required>
          {engines?.map((option) =>
            option.assembled === true ? (
              <option key={option.id} value={option.id} disabled>
                {t.enginePipeline}
              </option>
            ) : (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ),
          )}
        </Select>
      </Field>
      {assembled.map((engine) => (
        <p key={engine.id} className="text-[0.87rem] text-muted">
          {pipelineOffLine(t, engine)}
        </p>
      ))}
    </div>
  );
}
