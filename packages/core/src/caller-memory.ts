import { z } from "zod";
import { CALLER_PHONE_SQL, lockCall } from "./erasures";
import { enqueueTask } from "./queue";
import { TRANSCRIPT_RETENTION_SETTING, transcriptRetentionOf } from "./retention";
import type { OrgQuery } from "./types";

/**
 * As notas que o agente grava sobre quem ligou, para a próxima ligação do mesmo número (fatia 3 do
 * desenho de 13/11, registro 0020, 1A e 2A): o único ponto de escrita de `caller_notes`.
 *
 * A chave é (organização, telefone do outro lado): o telefone vem da linha da chamada, pelo mesmo
 * critério do apagamento a pedido do titular (`callerSideSql`), e nunca do modelo. O texto mora só
 * aqui, onde o prazo e o apagamento o alcançam: nem `tool_called`, nem evento, nem aviso o copiam.
 */

export const CALLER_NOTE_MAX = 300;
/** Quantas notas uma ligação grava. O mesmo teto vale no `runTool`, que conta as vagas da ferramenta. */
export const MAX_CALLER_NOTES_PER_CALL = 10;

/**
 * Prazo da memória, por organização, em dias (chave `caller_notes.retention_days` em `settings`;
 * decisão 2A). Ausente vale 90, e não "para sempre", ao contrário da transcrição: a nota só nasce
 * quando alguém marca a ferramenta, e os 90 dias valem desde a primeira.
 */
export const CALLER_NOTES_RETENTION_SETTING = "caller_notes.retention_days";
export const MIN_CALLER_NOTES_RETENTION_DAYS = 30;
export const MAX_CALLER_NOTES_RETENTION_DAYS = 365;
export const DEFAULT_CALLER_NOTES_RETENTION_DAYS = 90;
export const callerNotesRetentionSchema = z.number().int().min(MIN_CALLER_NOTES_RETENTION_DAYS).max(MAX_CALLER_NOTES_RETENTION_DAYS);

/** A tarefa que aplica o prazo da memória (`apps/routines/src/routines/purge_caller_notes.ts`). */
export const PURGE_CALLER_NOTES_TASK = "purge_caller_notes";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CallerNotesRetention {
  /** O que a organização gravou; `null` quando nunca gravou, e vale o de fábrica. */
  configured: number | null;
  /** O prazo da memória: o gravado ou o de fábrica. Nunca "para sempre". */
  days: number;
  /** O prazo de guarda da transcrição; `null` é "para sempre". */
  transcriptDays: number | null;
  /** O que vale: o menor entre o da memória e o da transcrição, quando a transcrição tem prazo. */
  effective: number;
}

/** O prazo da memória para um valor lido de `settings`. Ausente ou inválido vale o de fábrica: nunca guarda para sempre. */
export function callerNotesRetentionOf(stored: unknown): number {
  const parsed = callerNotesRetentionSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_CALLER_NOTES_RETENTION_DAYS;
}

/** Os dois prazos da organização e o que vale para as notas. */
export async function callerNotesRetention(q: OrgQuery): Promise<CallerNotesRetention> {
  const rows = await q.many<{ key: string; value: unknown }>("select key, value from settings where key = any($1)", [[CALLER_NOTES_RETENTION_SETTING, TRANSCRIPT_RETENTION_SETTING]]);
  const stored = rows.find((row) => row.key === CALLER_NOTES_RETENTION_SETTING)?.value;
  const parsed = callerNotesRetentionSchema.safeParse(stored);
  const configured = parsed.success ? parsed.data : null;
  const days = configured ?? DEFAULT_CALLER_NOTES_RETENTION_DAYS;
  const transcriptDays = transcriptRetentionOf(rows.find((row) => row.key === TRANSCRIPT_RETENTION_SETTING)?.value);
  return { configured, days, transcriptDays, effective: transcriptDays === null ? days : Math.min(days, transcriptDays) };
}

/**
 * Põe a rotina do prazo da memória na fila, se ainda não houver uma. A corrente é uma só por
 * organização e começa na primeira nota ou na mudança do prazo; a organização sem nota não tem tarefa.
 */
export async function scheduleCallerNotesPurge(q: OrgQuery, runAt: Date): Promise<boolean> {
  const queued = await q.one("select 1 from tasks where kind = $1 and status = 'queued'", [PURGE_CALLER_NOTES_TASK]);
  if (queued) return false;
  await enqueueTask(q, { kind: PURGE_CALLER_NOTES_TASK, payload: {}, runAt });
  return true;
}

/**
 * - `saved`: a nota foi gravada.
 * - `no_number`: a ligação não tem número do outro lado (o tronco não informou, chamada pelo
 *   navegador): não lembra nem é lembrada, e nada foi gravado.
 * - `limit`: a ligação já tem `MAX_CALLER_NOTES_PER_CALL` notas.
 * - `not_found`: a ligação não existe nesta organização, ou foi apagada a pedido do titular.
 */
export type SaveCallerNoteResult = { status: "saved"; id: string } | { status: "no_number" | "limit" | "not_found" };

/**
 * Grava uma nota da ligação `callId`. O telefone vem da linha da chamada (`CALLER_PHONE_SQL`, o lado de `callerSideSql`), nunca de quem chama. Trava a
 * linha da chamada como quem grava texto depois do fim (`lockCall`): o apagamento a pedido do
 * titular espera, ou já passou e a nota não nasce. Começa a corrente do prazo da memória quando ela
 * não existe.
 *
 * Só dentro de `withOrg`: numa transação de sistema a RLS não vale, e a nota não teria dona.
 */
export async function saveCallerNote(q: OrgQuery, input: { callId: string; text: string }, now: Date): Promise<SaveCallerNoteResult> {
  if (q.organizationId === "") throw new Error("saveCallerNote runs inside withOrg, never withSystem: the note would have no organization");
  const text = input.text.trim();
  if (text.length === 0 || text.length > CALLER_NOTE_MAX) throw new Error(`A caller note has 1 to ${CALLER_NOTE_MAX} characters`);
  const { erased } = await lockCall(q, input.callId);
  const call = await q.one<{ phone: string | null }>(`select ${CALLER_PHONE_SQL} as phone from calls where id = $1`, [input.callId]);
  if (!call || erased) return { status: "not_found" };
  if (!call.phone) return { status: "no_number" };
  const count = Number((await q.one<{ n: string }>("select count(*) as n from caller_notes where call_id = $1", [input.callId]))?.n ?? 0);
  if (count >= MAX_CALLER_NOTES_PER_CALL) return { status: "limit" };
  const row = await q.one<{ id: string }>("insert into caller_notes (organization_id, call_id, caller_e164, text, created_at) values ($1, $2, $3, $4, $5) returning id", [
    q.organizationId,
    input.callId,
    call.phone,
    text,
    now,
  ]);
  if (!row) throw new Error("Caller note was not created");
  await scheduleCallerNotesPurge(q, new Date(now.getTime() + DAY_MS));
  return { status: "saved", id: row.id };
}

/**
 * Apaga as notas criadas antes de `before` e devolve quantas saíram. A nota é apagada, e não trocada
 * por marcador: ela não tem lugar numa linha do tempo que precise continuar legível. Só dentro de
 * `withOrg`: numa transação de sistema o mesmo `delete` alcançaria todas as organizações.
 */
export async function purgeCallerNotes(q: OrgQuery, before: Date): Promise<number> {
  if (q.organizationId === "") throw new Error("purgeCallerNotes runs inside withOrg, never withSystem: it would reach every organization");
  return q.exec("delete from caller_notes where created_at < $1", [before]);
}
