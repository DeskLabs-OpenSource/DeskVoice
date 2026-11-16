import { describe, expect, it } from "vitest";
import { amountMarks, amountShown } from "./amount";

describe("amountShown", () => {
  it("sem linha não medida, o valor como sempre, inclusive o zero", () => {
    expect(amountShown(0, false)).toBe("money");
    expect(amountShown(1234, false)).toBe("money");
  });

  it("o zero com linha não medida nunca aparece como valor", () => {
    expect(amountShown(0, true)).toBe("unmeasured");
  });

  it("com parte medida, o valor e a marca juntos", () => {
    expect(amountShown(12, true)).toBe("money-and-unmeasured");
  });
});

describe("amountMarks", () => {
  it("0/0: o valor, sem marca nenhuma", () => {
    expect(amountMarks(0, 0, 0)).toEqual({ shown: "money", estimated: false });
    expect(amountMarks(1234, 0, 0)).toEqual({ shown: "money", estimated: false });
  });

  it("só não medido, com zero: só a marca de não medido, nunca o valor", () => {
    expect(amountMarks(0, 2, 0)).toEqual({ shown: "unmeasured", estimated: false });
  });

  it("medido mais não medido: o valor e a marca de parte não medida", () => {
    expect(amountMarks(12, 1, 0)).toEqual({ shown: "money-and-unmeasured", estimated: false });
  });

  it("estimado: o valor, com a marca de estimativa ao lado", () => {
    expect(amountMarks(30, 0, 1)).toEqual({ shown: "money", estimated: true });
  });

  it("estimado mais não medido com zero: a estimativa não esconde o não medido", () => {
    expect(amountMarks(0, 1, 1)).toEqual({ shown: "unmeasured", estimated: true });
  });

  it("estimado mais não medido com valor: as duas marcas", () => {
    expect(amountMarks(30, 1, 1)).toEqual({ shown: "money-and-unmeasured", estimated: true });
  });
});
