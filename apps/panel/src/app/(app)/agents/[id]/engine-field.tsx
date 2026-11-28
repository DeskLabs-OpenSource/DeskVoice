"use client";

import type { AgentsDictionary } from "../../../../i18n/pt-BR/agents";
import { Field, Select } from "../../../../ui/kit";
import { agentEngines, type Engine } from "../../../../ui/types";
import type { PipelineMissing } from "./pipeline-pieces";

/**
 * A linha que diz por que o Pipeline não pode ser escolhido: o motivo do servidor ou a peça que falta na
 * organização (fatia 6b). O motivo que o dicionário não conhece cai na frase geral; carregando, nada.
 */
export const pipelineOffLine = (t: AgentsDictionary, missing: PipelineMissing): string | null => (missing === "loading" ? null : (t.enginePipelineOff[missing] ?? t.enginePipelineOffUnknown));

/**
 * O motor com que o agente novo nasce: o padrão da instalação; sem padrão, o primeiro da lista. O
 * pipeline nunca é o motor de um agente (fatia 5b-1), nem o primeiro.
 */
export const newAgentEngine = (defaultId: string | null | undefined, engines: readonly Engine[] | undefined): string => defaultId ?? agentEngines(engines)[0]?.id ?? "";

/**
 * O campo "Motor de voz". Os motores de sempre ficam como estão. O Pipeline aparece na lista e é
 * escolhível quando está montado (`missing` nulo, fatia 6b); senão, desligado, com a linha do que falta.
 * Escolhido, a linha diz que a transcrição é provisória. Ele nunca é gravado em `engine` (a API recusa):
 * a página guarda o motor de antes e grava as peças do bloco em `agents.pipeline`.
 */
export function EngineField({
  t,
  engines,
  value,
  pipelineOn,
  missing,
  onChange,
}: {
  t: AgentsDictionary;
  engines: readonly Engine[] | undefined;
  /** O motor de `engine`, mostrado quando o Pipeline não está escolhido. */
  value: string;
  pipelineOn: boolean;
  /** O que falta para o Pipeline, ou `null` quando ele está montado. */
  missing: PipelineMissing | null;
  onChange(next: string): void;
}) {
  const pipeline = engines?.find((engine) => engine.assembled === true);
  const line = !pipeline ? null : pipelineOn ? t.pipelineTranscriberProvisional : missing === null ? t.enginePipelineReady : pipelineOffLine(t, missing);
  return (
    <div className="grid content-start gap-2">
      <Field label={t.engine}>
        <Select value={pipelineOn && pipeline ? pipeline.id : value} onChange={(event) => onChange(event.target.value)} required>
          {engines?.map((option) =>
            option.assembled === true ? (
              <option key={option.id} value={option.id} disabled={missing !== null && !pipelineOn}>
                {missing === null || pipelineOn ? t.enginePipelineOn : t.enginePipeline}
              </option>
            ) : (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ),
          )}
        </Select>
      </Field>
      {line ? <p className="text-[0.87rem] text-muted">{line}</p> : null}
    </div>
  );
}
