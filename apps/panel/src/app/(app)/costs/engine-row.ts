import { fill } from "../../../i18n/locales";
import type { CostsDictionary } from "../../../i18n/pt-BR/costs";
import type { Costs } from "../../../ui/types";

type EngineRow = Costs["byEngine"][number];

/**
 * O nome da linha "Por motor de voz". O analista ao vivo e os testes do agente (`source = 'test'`,
 * fatia 7c) saem separados do mesmo motor nas ligações, cada um com o nome dele.
 */
export function engineRowLabel(row: EngineRow, t: CostsDictionary): string {
  if (row.source === "analyst") return fill(t.analystLine, { model: row.label });
  if (row.source === "test") return fill(t.testLine, { engine: row.label });
  return row.label;
}

/** A nota debaixo da linha: o teste e o analista não têm minutos de ligação. */
export function engineRowNote(row: EngineRow, t: CostsDictionary): string {
  if (row.source === "analyst") return t.analystNote;
  if (row.source === "test") return t.testNote;
  return fill(t.minutes, { n: Math.round(row.callSeconds / 60) });
}
