// O campo do teto de gasto do mês (R8, fatia 7c): dólares na tela, centavos na API, e nada que vire
// `null` sem querer (o `null` tira o teto).
import { describe, expect, it } from "vitest";
import { spendCapField, spendCapValue } from "./spend-cap";

describe("o campo do teto de gasto do mês", () => {
  it("converte dólares em centavos, com ponto ou vírgula, sem erro de ponto flutuante", () => {
    expect(spendCapValue("50")).toEqual({ ok: true, cents: 5000 });
    expect(spendCapValue("49.90")).toEqual({ ok: true, cents: 4990 });
    expect(spendCapValue("0,29")).toEqual({ ok: true, cents: 29 });
    expect(spendCapValue("1.1")).toEqual({ ok: true, cents: 110 });
    expect(spendCapValue(" 0 ")).toEqual({ ok: true, cents: 0 });
  });

  it("vazio é sem teto; o que não é valor não vai", () => {
    expect(spendCapValue("")).toEqual({ ok: true, cents: null });
    expect(spendCapValue("   ")).toEqual({ ok: true, cents: null });
    for (const bad of ["abc", "-5", "1.234", "1e3", "1.", ".5", "R$ 10"]) expect(spendCapValue(bad), bad).toEqual({ ok: false });
  });

  it("mostra o teto salvo em dólares, e vazio quando não há", () => {
    expect(spendCapField(null)).toBe("");
    expect(spendCapField(4990)).toBe("49.90");
    expect(spendCapValue(spendCapField(4990))).toEqual({ ok: true, cents: 4990 });
  });
});
