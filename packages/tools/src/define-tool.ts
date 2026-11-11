import { z, type ZodType } from "zod";
import type { Tool } from "./types";

/**
 * Monta uma ferramenta derivando o JSON Schema do próprio zod: o que o modelo lê e o que a
 * validação aceita não têm como divergir.
 */
export function defineTool<Input>(tool: Omit<Tool<Input>, "parameters">): Tool<Input> {
  // `io: "input"`: campo com padrão não aparece como obrigatório para o modelo.
  const { $schema: _dialect, ...parameters } = z.toJSONSchema(tool.inputSchema as ZodType, { io: "input" });
  return { ...tool, parameters };
}
