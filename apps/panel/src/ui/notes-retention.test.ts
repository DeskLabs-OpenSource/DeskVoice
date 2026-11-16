import { describe, expect, it } from "vitest";
import en from "../i18n/en/privacy";
import ptBR from "../i18n/pt-BR/privacy";
import { notesRetentionNeedsConfirm, notesRetentionProblem } from "./notes-retention";

/** As duas regras da tela do prazo da memória (fatia 3a, ressalvas do Verificador no #295). */
const LIMITS = { minDays: 30, maxDays: 365 };

describe("notesRetentionProblem", () => {
  it("recusa um prazo da memória acima do prazo da transcrição, e diz qual é o da transcrição", () => {
    expect(notesRetentionProblem("61", { ...LIMITS, transcriptDays: 60 }, ptBR)).toBe("O prazo da memória não pode passar do prazo de guarda das conversas, que é de 60 dias.");
    expect(notesRetentionProblem("61", { ...LIMITS, transcriptDays: 60 }, en)).toContain("60");
  });

  it("aceita o próprio prazo da transcrição e qualquer valor abaixo dele", () => {
    expect(notesRetentionProblem("60", { ...LIMITS, transcriptDays: 60 }, ptBR)).toBeNull();
    expect(notesRetentionProblem("30", { ...LIMITS, transcriptDays: 60 }, ptBR)).toBeNull();
  });

  it("sem prazo da transcrição, só a faixa de 30 a 365 vale", () => {
    expect(notesRetentionProblem("365", { ...LIMITS, transcriptDays: null }, ptBR)).toBeNull();
    for (const bad of ["29", "366", "", " ", "45.5", "abc"]) {
      expect(notesRetentionProblem(bad, { ...LIMITS, transcriptDays: null }, ptBR)).toBe("Escolha um prazo de 30 a 365 dias.");
    }
  });

  it("fora da faixa vence: 400 com transcrição de 60 diz a faixa, e não o prazo da transcrição", () => {
    expect(notesRetentionProblem("400", { ...LIMITS, transcriptDays: 60 }, ptBR)).toBe("Escolha um prazo de 30 a 365 dias.");
  });
});

describe("notesRetentionNeedsConfirm", () => {
  it("encurtar pede confirmação, porque apaga notas; manter e alongar não", () => {
    expect(notesRetentionNeedsConfirm(60, 90)).toBe(true);
    expect(notesRetentionNeedsConfirm(90, 90)).toBe(false);
    expect(notesRetentionNeedsConfirm(120, 90)).toBe(false);
  });
});
