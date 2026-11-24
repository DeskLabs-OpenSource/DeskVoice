"use client";

import en from "../../../../i18n/en/timeline";
import es from "../../../../i18n/es/timeline";
import ptBR from "../../../../i18n/pt-BR/timeline";
import { useDict } from "../../../../i18n/provider";
import type { CallDetail } from "../../../../ui/types";
import { Amount } from "../../costs/amount-view";

/**
 * Quanto cada peça do pipeline gastou na ligação (fatia 5c): a transcrição, o cérebro e a voz, com o
 * mesmo valor do extrato que a tela de Custos soma. A peça sem linha no extrato (`lines: 0`) e a linha
 * sem custo medido aparecem como "não medido", e nunca como zero.
 */
export function PieceCosts({ rows }: { rows: CallDetail["costByPiece"] }) {
  const t = useDict(ptBR, en, es);
  const names = t.events.pipeline.pieces;
  return (
    <ul className="mt-1 grid gap-0.5 font-sans text-[0.8rem] text-muted">
      <li>{t.facts.byPiece}</li>
      {rows.map((row) => (
        <li key={`${row.piece}:${row.id ?? ""}`}>
          {names[row.piece] ?? row.piece}
          {row.id ? ` · ${row.label ?? row.id}` : ""}
          {row.model ? ` (${row.model})` : ""} · <span className="data">
            <Amount cents={row.costCents} unmeasuredCount={row.lines === 0 ? 1 : row.unmeasuredCount} estimatedCount={row.estimatedCount} />
          </span>
        </li>
      ))}
    </ul>
  );
}
