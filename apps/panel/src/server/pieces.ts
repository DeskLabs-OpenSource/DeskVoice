import type { Tool } from "@deskvoice/tools";
import type { DecisionModel, VoiceEngine } from "@deskvoice/voice-engine";

// `loadEngines()` e `loadTools()` leem a pasta em tempo de execução, e dentro do pacote compilado
// do Next essa pasta não existe. Aqui a descoberta é a mesma (por pasta, sem lista central), só
// que resolvida pelo empacotador: motor ou ferramenta nova aparece sem editar este arquivo.
// Carga preguiçosa de propósito: as peças importam `@deskvoice/core`, que o empacotador trata
// como módulo assíncrono, e a forma `eager` entrega o módulo antes de ele terminar de avaliar.
const engineModules = import.meta.glob<{ default: VoiceEngine }>(["../../../../packages/voice-engine/src/engines/*.ts", "!../../../../packages/voice-engine/src/engines/*.test.ts"]);
const deciderModules = import.meta.glob<{ default: DecisionModel }>(["../../../../packages/voice-engine/src/deciders/*.ts", "!../../../../packages/voice-engine/src/deciders/*.test.ts"]);
const toolModules = import.meta.glob<{ default: Tool }>(["../../../../packages/tools/src/tools/*.ts", "!../../../../packages/tools/src/tools/*.test.ts"]);

const loadAll = <T>(modules: Record<string, () => Promise<{ default: T }>>): Promise<T[]> =>
  Promise.all(Object.values(modules).map(async (load) => (await load()).default));

let engines: Promise<VoiceEngine[]> | undefined;
let tools: Promise<Tool[]> | undefined;
let deciders: Promise<DecisionModel[]> | undefined;

export function listEngines(): Promise<VoiceEngine[]> {
  return (engines ??= loadAll(engineModules));
}

/** Os modelos de decisão desta instalação (`deciders/`), descobertos como os motores. */
export function listDecisionModels(): Promise<DecisionModel[]> {
  return (deciders ??= loadAll(deciderModules));
}

/**
 * As ferramentas que o operador pode marcar no agente. A que declara `available: false` (a agenda,
 * que nenhum app liga ainda) fica de fora: a sessão não a ofereceria ao motor, e a marca sumiria
 * em silêncio. A que a sessão oferece sozinha (`offeredBySession`: a passagem entre agentes) também
 * fica: ela não é caixa de marcar.
 */
export async function listTools(): Promise<Array<{ name: string; description: string }>> {
  return (await (tools ??= loadAll(toolModules))).filter((tool) => tool.available !== false && tool.offeredBySession !== true).map((tool) => ({ name: tool.name, description: tool.description }));
}

export const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;
