// Pelo caminho dos tipos: o índice do pacote carrega a descoberta por pasta, que não existe no pacote do Next.
import type { PipelinePieceKind } from "@deskvoice/voice-engine/types";
import { listBrains } from "./brains";
import { listAllSynthesizers } from "./synthesizers";
import { listTranscribers } from "./transcribers";

/** As peças do pipeline, na ordem em que a fala passa por elas: o ouvido, o cérebro e a voz. */
export const PIECE_KINDS: readonly PipelinePieceKind[] = ["transcriber", "brain", "synthesizer"];

/**
 * A peça de uma linha do extrato. A sessão grava cada peça do pipeline com `engine = '<peça>:<id>'`
 * (`chargePiece`, seção 3.3 do desenho do pipeline), o mesmo rótulo `transcriber:<id>` do #245. Fora
 * dessa forma, a linha é de um motor direto, do filtro, do analista ou da classificação: `null`.
 */
export function pieceOfLedger(engine: string): { kind: PipelinePieceKind; id: string } | null {
  const at = engine.indexOf(":");
  if (at <= 0) return null;
  const kind = engine.slice(0, at);
  const id = engine.slice(at + 1);
  return id !== "" && (PIECE_KINDS as readonly string[]).includes(kind) ? { kind: kind as PipelinePieceKind, id } : null;
}

/**
 * Só as linhas das peças, numa consulta sobre `usage_ledger l`. A sessão grava cada uma com o agente do
 * trecho (`agent_id`); a classificação do desfecho pelo cérebro (R4) grava `brain:<id>` também, mas depois
 * da ligação e sem agente, em qualquer chamada, inclusive a do motor direto: ela fica de fora, com a
 * aparência de sempre.
 */
export const PIECE_LINE = `(l.agent_id is not null and split_part(l.engine, ':', 1) in ('transcriber', 'brain', 'synthesizer') and split_part(l.engine, ':', 2) <> '')`;

/** O nome de cada peça instalada, pela pasta. A peça que saiu da pasta fica sem nome, e a tela mostra o id. */
export async function pieceLabels(): Promise<(kind: PipelinePieceKind, id: string) => string | undefined> {
  const [transcribers, brains, synthesizers] = await Promise.all([listTranscribers(), listBrains(), listAllSynthesizers()]);
  const labels: Record<PipelinePieceKind, Map<string, string>> = {
    transcriber: new Map(transcribers.map((piece) => [piece.id, piece.label])),
    brain: new Map(brains.map((piece) => [piece.id, piece.label])),
    synthesizer: new Map(synthesizers.map((piece) => [piece.id, piece.label])),
  };
  return (kind, id) => labels[kind].get(id);
}
