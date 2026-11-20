import type { Engine } from "./types";

/**
 * Os três passos antes da primeira ligação: a lista de Chamadas (sem nenhuma chamada) e o cartão
 * "Primeiros passos" da central de Configurações (parte 3 do desenho da central). Uma lista só, para
 * as duas telas não divergirem. Os rótulos ficam no dicionário de Chamadas (`empty.steps`).
 */
export type FirstStepKey = "agent" | "line" | "engine";

export interface FirstStep {
  key: FirstStepKey;
  href: string;
  done: boolean;
}

/**
 * Se algum motor que pede chave já tem uma: o passo "chave de um motor" e o estado do cartão de
 * Motores de voz leem isto, da mesma resposta de `GET /engines`. Sem a resposta, `undefined`.
 */
export const engineReady = (engines: readonly Engine[] | undefined): boolean | undefined =>
  engines === undefined ? undefined : engines.some((engine) => engine.requiresKey && engine.keyConfigured);

/** Os passos, na ordem. O que ainda não carregou conta como não feito. */
export function firstSteps(read: { agents: readonly unknown[] | undefined; trunks: readonly unknown[] | undefined; engines: readonly Engine[] | undefined }): FirstStep[] {
  return [
    { key: "agent", href: "/agents", done: (read.agents?.length ?? 0) > 0 },
    { key: "line", href: "/line", done: (read.trunks?.length ?? 0) > 0 },
    { key: "engine", href: "/settings/ai", done: engineReady(read.engines) ?? false },
  ];
}

/**
 * Se o cartão "Primeiros passos" aparece: só com as três leituras de volta e algum passo por fazer.
 * Enquanto carrega, ou com uma leitura falhando, o cartão não aparece, em vez de piscar.
 */
export function firstStepsPending(read: Parameters<typeof firstSteps>[0]): FirstStep[] | null {
  if (read.agents === undefined || read.trunks === undefined || read.engines === undefined) return null;
  const steps = firstSteps(read);
  return steps.every((step) => step.done) ? null : steps;
}
