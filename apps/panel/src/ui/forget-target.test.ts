import { describe, expect, it } from "vitest";
import { forgetTarget } from "./forget-target";

describe('forgetTarget: o número que a confirmação de "Esquecer" nomeia', () => {
  it("normaliza o que foi digitado, como a rota normaliza", () => {
    expect(forgetTarget("31999990000")).toBe("+5531999990000");
    expect(forgetTarget(" (31) 99999-0000 ")).toBe("+5531999990000");
    expect(forgetTarget("+55 31 99999-0000")).toBe("+5531999990000");
  });

  it("recusa o número inválido, que não pode abrir a confirmação", () => {
    expect(forgetTarget("999990000")).toBeNull();
    expect(forgetTarget("")).toBeNull();
    expect(forgetTarget("abc")).toBeNull();
  });
});
