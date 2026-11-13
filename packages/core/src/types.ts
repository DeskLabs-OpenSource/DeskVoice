import type { Pool, QueryResultRow } from "pg";

/** Relógio injetável. Código de produto nunca chama `new Date()` direto: recebe um `Clock`. */
export interface Clock {
  now(): Date;
}

export interface Db {
  /** Pool do papel de aplicação (`deskvoice_app`), sujeito a RLS. */
  pool: Pool;
  /** Pool do papel de sistema (`deskvoice_system`), que atravessa organizações. Só `withSystem` usa. */
  systemPool?: Pool;
  close(): Promise<void>;
}

/**
 * Consulta presa a uma organização. Só existe dentro de `withOrg` (ou de `withSystem`,
 * para o punhado de operações que atravessam organizações: login, fila, roteamento de chamada).
 */
export interface OrgQuery {
  organizationId: string;
  many<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string, params?: unknown[]): Promise<number>;
}

export const CALL_EVENT_KINDS = [
  "call_started",
  "call_answered",
  "recording_notice",
  "transcript_user",
  "transcript_agent",
  "tool_called",
  "tool_result",
  "approval_requested",
  "approval_decided",
  "human_notified",
  "dtmf_sent",
  "transfer_started",
  "transfer_completed",
  "engine_failed",
  "call_refused",
  "cost_ceiling_reached",
  "recording_skipped",
  "recording_failed",
  "recording_paused",
  "call_ended",
  "task_queued",
  "task_finished",
  "follow_up_created",
  "follow_up_assigned",
  "follow_up_closed",
  "outcome_not_classified",
  "call_analyzed",
  "analysis_not_done",
] as const;

export type CallEventKind = (typeof CALL_EVENT_KINDS)[number];

/**
 * O que acontece na organização fora de uma chamada e precisa ficar registrado
 * (`organization_events`). Fechado como o da chamada: acontecimento novo entra aqui.
 */
export const ORG_EVENT_KINDS = ["transcript_retention_changed", "transcripts_purged", "caller_data_exported", "call_recording_changed"] as const;

export type OrgEventKind = (typeof ORG_EVENT_KINDS)[number];

export type CallStatus = "ringing" | "in_progress" | "transferred" | "completed" | "failed" | "refused";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ApprovalOutcome = Exclude<ApprovalStatus, "pending">;

export interface ClaimedTask {
  id: string;
  organizationId: string;
  callId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface Config {
  databaseUrl: string;
  /** Conexão do papel de sistema (`deskvoice_system`); alimenta `withSystem` e a fila. */
  systemDatabaseUrl: string;
  /** Conexão do dono do schema; só o comando de migrations a recebe. */
  migrationDatabaseUrl?: string;
  secretKey: Buffer;
  publicUrl: string;
  ariUrl: string;
  ariApp: string;
  ariUsername: string;
  ariPassword: string;
  audioSocketPort: number;
  panelPort: number;
}
