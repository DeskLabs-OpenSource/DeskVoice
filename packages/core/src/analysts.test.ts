import { describe, expect, it } from "vitest";
import { analystFieldsSchema, analystObjectionsOf, analystObjectionsSchema } from "./analysts";

const objection = (key: string, extra: Record<string, unknown> = {}) => ({ key, label: "Preço", guidance: "Reforce o que está incluso; não ofereça desconto.", ...extra });
const valid = { name: "Jev", decisionModel: "simulated", temperature: true, objections: [objection("price")] };

describe("analystFieldsSchema", () => {
  it("aceita o analista da seção 3.1 e apara os textos", () => {
    const parsed = analystFieldsSchema.parse({ ...valid, name: "  Jev  ", objections: [objection("price", { label: " Preço ", guidance: " Reforce. " })] });
    expect(parsed).toEqual({ name: "Jev", decisionModel: "simulated", temperature: true, objections: [{ key: "price", label: "Preço", guidance: "Reforce." }] });
  });

  it("nome de 1 a 40 caracteres", () => {
    expect(analystFieldsSchema.safeParse({ ...valid, name: "x".repeat(40) }).success).toBe(true);
    for (const name of ["", "   ", "x".repeat(41)]) expect(analystFieldsSchema.safeParse({ ...valid, name }).success).toBe(false);
  });

  it("de 0 a 8 objeções", () => {
    expect(analystFieldsSchema.safeParse({ ...valid, objections: [] }).success).toBe(true);
    const eight = Array.from({ length: 8 }, (_, i) => objection(`o${i}`));
    expect(analystFieldsSchema.safeParse({ ...valid, objections: eight }).success).toBe(true);
    expect(analystFieldsSchema.safeParse({ ...valid, objections: [...eight, objection("o8")] }).success).toBe(false);
  });

  it("key no formato ^[a-z0-9_]{1,30}$, única e diferente de none", () => {
    for (const key of ["a", "preco_alto", "x".repeat(30), "0_9"]) expect(analystObjectionsSchema.safeParse([objection(key)]).success).toBe(true);
    for (const key of ["", "Preço", "preco-alto", "preco alto", "PRICE", "x".repeat(31), "none"]) {
      expect(analystObjectionsSchema.safeParse([objection(key)]).success, key).toBe(false);
    }
    expect(analystObjectionsSchema.safeParse([objection("price"), objection("price", { label: "Outro" })]).success).toBe(false);
  });

  it("label até 60 e guidance até 280, nenhum dos dois vazio", () => {
    expect(analystObjectionsSchema.safeParse([objection("p", { label: "x".repeat(60), guidance: "y".repeat(280) })]).success).toBe(true);
    for (const extra of [{ label: "x".repeat(61) }, { guidance: "y".repeat(281) }, { label: " " }, { guidance: "" }]) {
      expect(analystObjectionsSchema.safeParse([objection("p", extra)]).success, JSON.stringify(extra)).toBe(false);
    }
  });
});

describe("analystObjectionsOf", () => {
  it("devolve as objeções gravadas que passam pela regra", () => {
    expect(analystObjectionsOf([objection("price")])).toEqual([objection("price")]);
  });

  it("linha fora da regra vale como nenhuma objeção, nunca como texto que a regra recusaria", () => {
    for (const stored of [null, undefined, "price", {}, [objection("none")], [objection("price", { guidance: "y".repeat(281) })], [{ key: "price" }]]) {
      expect(analystObjectionsOf(stored)).toEqual([]);
    }
  });
});
