import type { ToolSpec } from "@deskvoice/voice-engine";
import type { Tool } from "./types";

/** O que o motor de voz recebe de uma ferramenta: nome, descrição e JSON Schema dos argumentos. */
export function toSpec(tool: Tool): ToolSpec {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
