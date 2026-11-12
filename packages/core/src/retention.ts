import { z } from "zod";

/**
 * Prazo de guarda da transcrição, por organização, em dias (chave `transcripts.retention_days` em
 * `settings`). Ausente guarda para sempre, que é o comportamento de antes dele existir. O piso de
 * 30 dias protege a conversa recente, que ainda vira resumo e pode ser revista por quem atende.
 */
export const TRANSCRIPT_RETENTION_SETTING = "transcripts.retention_days";
export const MIN_TRANSCRIPT_RETENTION_DAYS = 30;
export const MAX_TRANSCRIPT_RETENTION_DAYS = 3650;
export const transcriptRetentionSchema = z.number().int().min(MIN_TRANSCRIPT_RETENTION_DAYS).max(MAX_TRANSCRIPT_RETENTION_DAYS);

/** A tarefa que aplica o prazo (`apps/routines/src/routines/purge_transcripts.ts`). */
export const PURGE_TRANSCRIPTS_TASK = "purge_transcripts";

/** O prazo em vigor para um valor lido de `settings`. Ausente ou inválido vale "para sempre": nunca apaga por engano. */
export function transcriptRetentionOf(stored: unknown): number | null {
  const parsed = transcriptRetentionSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}
