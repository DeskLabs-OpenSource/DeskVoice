import type { CriterionStatus, RubricCriterionId, StoredCallAnalysis } from "@deskvoice/core";

/**
 * A apresentação da análise da ligação (desenho `docs/specs/2026-11-13-analise-da-ligacao.md`,
 * seção 3.7). Só tipos de `@deskvoice/core`: o pacote leva `pg`, que não entra no navegador. O
 * teste ao lado confere que estes pontos dão a mesma nota que `scoreOf`.
 */

/** Quanto cada critério vale inteiro: o `points` de `RUBRIC`, versão 1. */
export const CRITERION_MAX = 2;
const POINTS: Record<CriterionStatus, number> = { met: CRITERION_MAX, partial: CRITERION_MAX / 2, missed: 0 };

export interface RubricRow {
  id: RubricCriterionId;
  status: CriterionStatus;
  points: number;
  /** O texto do dicionário que explica os pontos: "soma" quando cumpriu, "tira" quando perdeu algum. */
  side: "adds" | "takes";
  /** A fala entre aspas; `null` quando veio vazia, quando a análise foi expurgada, ou apagada a pedido. */
  evidence: string | null;
}

export interface AnalysisView {
  rows: RubricRow[];
  /** A soma dos pontos de `rows`: a tela não lê outro número para a nota. */
  score: number;
}

export function analysisView(analysis: StoredCallAnalysis): AnalysisView {
  const rows = analysis.criteria.map((criterion): RubricRow => {
    const evidence = "evidence" in criterion && criterion.evidence.trim() !== "" ? criterion.evidence : null;
    return { id: criterion.id, status: criterion.status, points: POINTS[criterion.status], side: criterion.status === "met" ? "adds" : "takes", evidence };
  });
  return { rows, score: rows.reduce((sum, row) => sum + row.points, 0) };
}
