import { z, type ZodType } from "zod";

/**
 * O que vem de um servidor MCP é dado de terceiro. Aqui mora a conferência das duas camadas: a
 * resposta do servidor (o envelope JSON-RPC e o resultado de cada pedido) e o `inputSchema` de cada
 * ferramenta, aceito só num subconjunto fechado e convertido por nós em zod. O que não passa não
 * chega ao motor.
 */

/** As versões do protocolo que o cliente sabe falar. A primeira é a que ele pede. */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-11-25", "2025-03-26", "2024-11-05"] as const;

const requestId = z.union([z.string(), z.number()]);

/**
 * A resposta JSON-RPC a um pedido. Os membros do envelope são fechados pela especificação do
 * JSON-RPC 2.0, por isso `strict`. O conteúdo de `result` é conferido por pedido, logo abaixo.
 */
export const rpcResponseSchema = z.union([
  z.strictObject({ jsonrpc: z.literal("2.0"), id: requestId, result: z.record(z.string(), z.unknown()) }),
  z.strictObject({
    jsonrpc: z.literal("2.0"),
    id: requestId.nullable(),
    error: z.object({ code: z.number().int(), message: z.string(), data: z.unknown().optional() }),
  }),
]);

// Dentro do `result`, o protocolo deixa o servidor mandar campos a mais (`_meta`, extensões). O zod
// os descarta: só o que está escrito aqui segue adiante.
export const initializeResultSchema = z.object({
  protocolVersion: z.enum(MCP_PROTOCOL_VERSIONS),
  capabilities: z.record(z.string(), z.unknown()),
  serverInfo: z.object({ name: z.string(), version: z.string() }).optional(),
});

export const listedToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: z.object({ readOnlyHint: z.boolean().optional() }).optional(),
});

export const toolsListResultSchema = z.object({
  tools: z.array(z.unknown()),
  nextCursor: z.string().optional(),
});

export const toolsCallResultSchema = z.object({
  content: z.array(z.looseObject({ type: z.string() })),
  isError: z.boolean().optional(),
});

/** Até quanto da descrição de um campo vai ao motor. */
export const MCP_FIELD_DESCRIPTION_MAX = 200;

/** O nome que o motor vê: `<slug>__<nome>`, só com estes caracteres e até 64 deles. */
export const ENGINE_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const PROPERTY_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** O nome da ferramenta MCP como o motor a vê. */
export const mcpToolName = (slug: string, name: string): string => `${slug}__${name}`;

/** O nome do servidor pode ir ao motor, com o prefixo do `slug`. */
export function isSupportedToolName(slug: string, name: string): boolean {
  return ENGINE_TOOL_NAME.test(name) && ENGINE_TOOL_NAME.test(mcpToolName(slug, name));
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

// Palavras que não mudam o que é aceito e que os geradores de esquema costumam pôr: são ignoradas.
const ANNOTATIONS = new Set(["description", "title", "default", "examples"]);

/** Só as palavras de `allowed` (e as anotações), cada uma com o tipo certo; qualquer outra recusa. */
function onlyKeys(schema: Json, allowed: readonly string[]): boolean {
  return Object.keys(schema).every((key) => allowed.includes(key) || ANNOTATIONS.has(key));
}

function describe<T extends ZodType>(type: T, schema: Json): T {
  return typeof schema.description === "string" && schema.description !== "" ? type.describe(schema.description.slice(0, MCP_FIELD_DESCRIPTION_MAX)) : type;
}

const nonNegativeInt = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** Um campo que não é lista: `string`, `number`, `integer` ou `boolean`. */
function scalar(schema: unknown): ZodType | null {
  if (!isObject(schema)) return null;
  if (schema.description !== undefined && typeof schema.description !== "string") return null;
  switch (schema.type) {
    case "string": {
      if (!onlyKeys(schema, ["type", "enum", "minLength", "maxLength", "format"])) return null;
      if (schema.format !== undefined && typeof schema.format !== "string") return null;
      if (schema.enum !== undefined) {
        // `enum` com outras restrições de tamanho é redundante; para não decidir qual vale, recusa.
        if (!Array.isArray(schema.enum) || schema.enum.length === 0 || !schema.enum.every((item) => typeof item === "string")) return null;
        if (schema.minLength !== undefined || schema.maxLength !== undefined) return null;
        return describe(z.enum(schema.enum as [string, ...string[]]), schema);
      }
      let type = z.string();
      if (schema.minLength !== undefined) {
        if (!nonNegativeInt(schema.minLength)) return null;
        type = type.min(schema.minLength);
      }
      if (schema.maxLength !== undefined) {
        if (!nonNegativeInt(schema.maxLength)) return null;
        type = type.max(schema.maxLength);
      }
      // `format` é ignorado: a validação de formato fica com quem recebe.
      return describe(type, schema);
    }
    case "number":
      return onlyKeys(schema, ["type"]) ? describe(z.number(), schema) : null;
    case "integer":
      return onlyKeys(schema, ["type"]) ? describe(z.number().int(), schema) : null;
    case "boolean":
      return onlyKeys(schema, ["type"]) ? describe(z.boolean(), schema) : null;
    default:
      return null;
  }
}

function field(schema: unknown): ZodType | null {
  if (isObject(schema) && schema.type === "array") {
    if (!onlyKeys(schema, ["type", "items"])) return null;
    if (schema.description !== undefined && typeof schema.description !== "string") return null;
    const items = scalar(schema.items);
    return items === null ? null : describe(z.array(items), schema);
  }
  return scalar(schema);
}

/**
 * Converte o `inputSchema` de uma ferramenta MCP em zod, ou devolve `null` se ele sai do
 * subconjunto fechado: objeto no topo; `properties` com `string` (`enum`, `minLength`, `maxLength`;
 * `format` ignorado), `number`, `integer`, `boolean` e `array` de qualquer um desses; `required`;
 * `description` em cada campo, cortada em 200 caracteres. Qualquer outra palavra (`$ref`, `oneOf`,
 * objeto aninhado, `additionalProperties` com esquema, `minimum`…) recusa a ferramenta inteira.
 *
 * O mesmo esquema vai à OpenAI e ao Gemini, que aceitam subconjuntos diferentes de JSON Schema, e o
 * motor recebe o JSON Schema derivado deste zod (pelo `defineTool`), nunca o que o servidor mandou.
 */
export function inputSchemaToZod(schema: unknown): ZodType<Record<string, unknown>> | null {
  if (!isObject(schema) || schema.type !== "object") return null;
  if (!onlyKeys(schema, ["type", "properties", "required", "additionalProperties", "$schema"])) return null;
  if (schema.$schema !== undefined && typeof schema.$schema !== "string") return null;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") return null;
  const properties = schema.properties ?? {};
  if (!isObject(properties)) return null;
  const required = schema.required ?? [];
  if (!Array.isArray(required) || !required.every((name) => typeof name === "string" && Object.hasOwn(properties, name))) return null;

  const shape: Record<string, ZodType> = Object.create(null) as Record<string, ZodType>;
  for (const [name, property] of Object.entries(properties)) {
    if (!PROPERTY_NAME.test(name) || name === "__proto__") return null;
    const type = field(property);
    if (type === null) return null;
    shape[name] = required.includes(name) ? type : type.optional();
  }
  const object = schema.additionalProperties === false ? z.strictObject({ ...shape }) : z.object({ ...shape });
  return object as unknown as ZodType<Record<string, unknown>>;
}
