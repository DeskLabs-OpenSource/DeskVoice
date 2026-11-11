import type { Tool } from "@deskvoice/tools";
import type { VoiceEngine } from "@deskvoice/voice-engine";

// `loadEngines()` e `loadTools()` leem a pasta em tempo de execução, e dentro do pacote compilado
// do Next essa pasta não existe. Aqui a descoberta é a mesma (por pasta, sem lista central), só
// que resolvida pelo empacotador: motor ou ferramenta nova aparece sem editar este arquivo.
// Carga preguiçosa de propósito: as peças importam `@deskvoice/core`, que o empacotador trata
// como módulo assíncrono, e a forma `eager` entrega o módulo antes de ele terminar de avaliar.
const engineModules = import.meta.glob<{ default: VoiceEngine }>(["../../../../packages/voice-engine/src/engines/*.ts", "!../../../../packages/voice-engine/src/engines/*.test.ts"]);
const toolModules = import.meta.glob<{ default: Tool }>(["../../../../packages/tools/src/tools/*.ts", "!../../../../packages/tools/src/tools/*.test.ts"]);

const loadAll = <T>(modules: Record<string, () => Promise<{ default: T }>>): Promise<T[]> =>
  Promise.all(Object.values(modules).map(async (load) => (await load()).default));

let engines: Promise<VoiceEngine[]> | undefined;
let tools: Promise<Tool[]> | undefined;

export function listEngines(): Promise<VoiceEngine[]> {
  return (engines ??= loadAll(engineModules));
}

export async function listTools(): Promise<Array<{ name: string; description: string }>> {
  return (await (tools ??= loadAll(toolModules))).map((tool) => ({ name: tool.name, description: tool.description }));
}

export const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;
