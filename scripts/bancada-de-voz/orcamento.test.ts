/** O teto, com e sem reservas em aberto. */
import { describe, expect, it } from "vitest";
import { Orcamento } from "./orcamento";

describe("Orcamento", () => {
  it("a reserva em aberto conta como gasto, e fechar troca a estimativa pelo valor real", () => {
    const o = new Orcamento(10);
    const a = o.reservar(4, "a");
    const b = o.reservar(4, "b");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // 4 + 4 em voo: a terceira de 4 não cabe, mesmo sem nada gasto ainda.
    expect(o.gasto).toBe(0);
    expect(o.reservar(4, "c")).toBeNull();
    a?.fechar(1);
    b?.fechar(1);
    expect(o.gasto).toBe(2);
    expect(o.porServico()).toEqual([["a", 1], ["b", 1]]);
    // As reservas voltaram: agora cabe.
    expect(o.cabe(8)).toBe(true);
    expect(o.cabe(8.5)).toBe(false);
  });

  it("fechar duas vezes não soma de novo, e a reserva recusada não muda nada", () => {
    const o = new Orcamento(1);
    const r = o.reservar(1, "a");
    r?.fechar(0.5);
    r?.fechar(0.5);
    expect(o.gasto).toBe(0.5);
    expect(o.reservar(0.6, "a")).toBeNull();
    expect(o.cabe(0.5)).toBe(true);
  });

  it("o custo real que passa do pior caso reservado trava as reservas novas, e o orçamento diz quanto passou", () => {
    const o = new Orcamento(10);
    const emVoo = o.reservar(1, "a");
    const outra = o.reservar(1, "a");
    emVoo?.fechar(1.5);
    expect(o.excesso).toBeCloseTo(0.5, 12);
    expect(o.gasto).toBeCloseTo(1.5, 12);
    // Ainda cabe no teto, mas o pior caso deixou de ser pior caso: nada novo começa.
    expect(o.cabe(1)).toBe(true);
    expect(o.reservar(1, "a")).toBeNull();
    // A que já estava em voo fecha normalmente, e o excesso só soma o que passou.
    outra?.fechar(0.2);
    expect(o.excesso).toBeCloseTo(0.5, 12);
    expect(o.gasto).toBeCloseTo(1.7, 12);
  });

  it("o custo real igual ao reservado não é excesso", () => {
    const o = new Orcamento(1);
    o.reservar(0.5)?.fechar(0.5);
    expect(o.excesso).toBe(0);
    expect(o.reservar(0.5)).not.toBeNull();
  });

  it("teto inválido não começa", () => {
    expect(() => new Orcamento(Number.NaN)).toThrow(RangeError);
    expect(() => new Orcamento(-1)).toThrow(RangeError);
  });
});
