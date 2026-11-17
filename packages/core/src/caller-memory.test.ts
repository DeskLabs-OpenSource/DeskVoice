import { describe, expect, it } from "vitest";
import { CALLER_MEMORY_MAX_CHARS, fitCallerMemory, maskPhoneNumbers } from "./caller-memory";
import { rememberedBlock, type RememberedItem } from "./remembered-text";

const CALLER = "+5531922221111";

describe("maskPhoneNumbers", () => {
  it("o número da própria ligação vira `este número`", () => {
    expect(maskPhoneNumbers(`Retornar para ${CALLER}: não conseguiu marcar`, CALLER)).toBe("Retornar para este número: não conseguiu marcar");
  });

  it("outro número E.164 vira `[número]`, e um número que só começa como o da ligação não é o da ligação", () => {
    expect(maskPhoneNumbers("Ligar para +5531900000000 ou +442071838750", CALLER)).toBe("Ligar para [número] ou [número]");
    expect(maskPhoneNumbers(`Retornar para ${CALLER}9`, CALLER)).toBe("Retornar para [número]");
  });

  it("o texto sem número sai igual", () => {
    const text = "Confirmar o retorno de terça, às 14h, sala 12.";
    expect(maskPhoneNumbers(text, CALLER)).toBe(text);
  });
});

describe("fitCallerMemory com o motivo e o resumo da passagem na frente", () => {
  const notes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, text: `${i}`.padEnd(100, "x") }));
  const followUps = [{ id: "p0", title: "Retornar para este número: confirmar o horário" }];
  const lead: RememberedItem[] = [
    { label: "motivo", text: "m".repeat(300) },
    // O resumo vai até 1 000, mas com 300 de motivo e 1 000 de resumo o bloco sozinho já passa de
    // 1 500 (1 606, com a frase fixa e os marcadores), e nenhuma nota cabe: o caso de baixo.
    { label: "resumo", text: "r".repeat(600) },
  ];

  it("o teto mede o bloco inteiro, corta a nota mais velha primeiro e nunca corta o lead", () => {
    // Sozinha, a memória cabe inteira; com o lead, não.
    expect(fitCallerMemory(notes, followUps)?.noteIds).toHaveLength(10);
    const fitted = fitCallerMemory(notes, followUps, lead);
    if (!fitted) throw new Error("some memory should fit");
    const block = rememberedBlock([...lead, ...fitted.items]);
    expect(block.length).toBeLessThanOrEqual(CALLER_MEMORY_MAX_CHARS);
    expect(fitted.chars).toBe(block.length);
    // `items` sem o lead; as notas que ficaram são as mais novas, e mais uma passaria do teto.
    expect(fitted.items.map((item) => item.label)).not.toContain("motivo");
    const kept = fitted.noteIds.length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(10);
    expect(fitted.noteIds).toEqual(notes.slice(0, kept).map((note) => note.id));
    expect(fitted.followUpIds).toEqual(["p0"]);
    expect(fitted.notes).toEqual(notes.slice(0, kept));
    expect(fitted.followUps).toEqual(followUps);
    const oneMore = [...lead, ...notes.slice(0, kept + 1).map((note) => ({ label: "nota", text: note.text })), { label: "pendência", text: followUps[0]?.title ?? "" }];
    expect(rememberedBlock(oneMore).length).toBeGreaterThan(CALLER_MEMORY_MAX_CHARS);
  });

  it("motivo de 300 e resumo de 1 000: o lead sozinho passa do teto, nenhum item de memória cabe, e não há memória", () => {
    const longest: RememberedItem[] = [
      { label: "motivo", text: "m".repeat(300) },
      { label: "resumo", text: "r".repeat(1000) },
    ];
    expect(rememberedBlock(longest).length).toBeGreaterThan(CALLER_MEMORY_MAX_CHARS);
    expect(fitCallerMemory(notes, followUps, longest)).toBeNull();
  });

  it("sem lead, o resultado é o de antes", () => {
    const fitted = fitCallerMemory(notes, followUps);
    expect(fitted?.chars).toBe(rememberedBlock(fitted?.items ?? []).length);
  });
});
