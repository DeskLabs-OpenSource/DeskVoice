import { z } from "zod";
import { describe, expect, it } from "vitest";
import { inputSchemaToZod, isSupportedToolName, MCP_FIELD_DESCRIPTION_MAX } from "./schema";

const object = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type: "object", properties, ...extra });

describe("inputSchemaToZod: o subconjunto fechado", () => {
  it("aceita os tipos do subconjunto e confere o que o modelo manda", () => {
    const schema = inputSchemaToZod(
      object(
        {
          pedido: { type: "string", minLength: 1, maxLength: 10, format: "uuid", description: "O pedido" },
          status: { type: "string", enum: ["aberto", "fechado"] },
          valor: { type: "number" },
          quantidade: { type: "integer" },
          urgente: { type: "boolean" },
          etiquetas: { type: "array", items: { type: "string" } },
        },
        { required: ["pedido"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#", title: "Entrada" },
      ),
    );
    expect(schema).not.toBeNull();
    expect(schema?.safeParse({ pedido: "1234", status: "aberto", valor: 1.5, quantidade: 2, urgente: true, etiquetas: ["a"] }).success).toBe(true);
    // O `format` é ignorado: o texto não precisa ser uuid.
    expect(schema?.safeParse({ pedido: "1234" }).success).toBe(true);
    for (const bad of [{}, { pedido: "" }, { pedido: "12345678901" }, { pedido: "1", status: "outro" }, { pedido: "1", quantidade: 1.5 }, { pedido: "1", etiquetas: [1] }, { pedido: "1", extra: true }]) {
      expect(schema?.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("o JSON Schema que o motor recebe sai do zod, com a descrição cortada", () => {
    const schema = inputSchemaToZod(object({ nota: { type: "string", description: "x".repeat(500) } }, { required: ["nota"] }));
    const json = z.toJSONSchema(schema as z.ZodType, { io: "input" }) as unknown as { properties: { nota: { description: string } }; required: string[] };
    expect(json.properties.nota.description).toHaveLength(MCP_FIELD_DESCRIPTION_MAX);
    expect(json.required).toEqual(["nota"]);
  });

  it("objeto sem propriedades é aceito", () => {
    expect(inputSchemaToZod({ type: "object" })?.safeParse({}).success).toBe(true);
  });

  it.each([
    ["topo que não é objeto", { type: "string" }],
    ["$ref", object({ a: { $ref: "#/$defs/a" } })],
    ["$defs no topo", object({}, { $defs: {} })],
    ["oneOf", object({ a: { oneOf: [{ type: "string" }, { type: "number" }] } })],
    ["anyOf no topo", { type: "object", anyOf: [] }],
    ["objeto aninhado", object({ a: { type: "object", properties: {} } })],
    ["additionalProperties com esquema", object({}, { additionalProperties: { type: "string" } })],
    ["lista de listas", object({ a: { type: "array", items: { type: "array", items: { type: "string" } } } })],
    ["lista sem items", object({ a: { type: "array" } })],
    ["tipo em lista", object({ a: { type: ["string", "null"] } })],
    ["palavra fora do subconjunto (minimum)", object({ a: { type: "number", minimum: 0 } })],
    ["pattern", object({ a: { type: "string", pattern: "^a" } })],
    ["enum que não é texto", object({ a: { type: "string", enum: [1, 2] } })],
    ["enum vazio", object({ a: { type: "string", enum: [] } })],
    ["required com campo que não existe", object({ a: { type: "string" } }, { required: ["b"] })],
    ["nome de campo com espaço", object({ "a b": { type: "string" } })],
    ["__proto__ como campo", JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}') as unknown],
    ["descrição que não é texto", object({ a: { type: "string", description: 1 } })],
    ["minLength negativo", object({ a: { type: "string", minLength: -1 } })],
  ])("recusa %s", (_label, schema) => {
    expect(inputSchemaToZod(schema)).toBeNull();
  });
});

describe("isSupportedToolName", () => {
  it("o nome do motor só tem [a-zA-Z0-9_-] e cabe em 64 caracteres", () => {
    expect(isSupportedToolName("erp", "consultar_pedido")).toBe(true);
    expect(isSupportedToolName("erp", "a".repeat(59))).toBe(true);
    expect(isSupportedToolName("erp", "a".repeat(60))).toBe(false);
    for (const name of ["com espaço", "ponto.final", "acentuação", ""]) expect(isSupportedToolName("erp", name), name).toBe(false);
  });
});
