// Só tipos: o compilador os apaga, e nada do servidor chega ao navegador.
import type { KeyCheckView } from "../server/engine-key";
import type { HealthLine, HealthStatus } from "../server/health";
export type Role = "owner" | "admin" | "operator";
export interface Me {
  name: string;
  email: string;
  role: Role;
  phone?: string | null;
  whatsapp?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  roleLabel: string | null;
  instructions: string;
  greeting: string | null;
  engine: string;
  voiceId: string | null;
  language: string;
  tools: string[];
  enabled: boolean;
  maxCallSeconds: number;
  costCeilingCents: number;
  transferTo: string | null;
}

export type CallStatus = "ringing" | "in_progress" | "transferred" | "completed" | "failed" | "refused";
export interface Call {
  id: string;
  agentId: string | null;
  agentName: string | null;
  direction: "inbound" | "outbound";
  from: string | null;
  to: string | null;
  status: CallStatus;
  endReason: string | null;
  engine: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  costCents: number;
  summary: string | null;
  costCeilingCents?: number | null;
}

export interface CallEvent {
  id: string;
  at: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface Approval {
  id: string;
  callId: string;
  question: string;
  context: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "expired";
  defaultOnTimeout: "approved" | "denied";
  expiresAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  from: string | null;
  agentName: string | null;
}

export interface Trunk {
  id: string;
  name: string;
  host: string;
  username: string | null;
  authMode: "register" | "ip";
  callerId: string | null;
  status: string;
  lastCheckAt: string | null;
  lastError: string | null;
  secret: { configured: boolean };
  applied?: boolean;
}

export interface PhoneNumber {
  id: string;
  e164: string;
  trunkId: string;
  agentId: string | null;
  agentName?: string | null;
}

export type KeyCheck = KeyCheckView;
export type KeyCheckResult = KeyCheckView["result"];

export interface Engine {
  id: string;
  label: string;
  /** Quem processa o áudio. */
  provedor: string;
  /** Onde o áudio é processado; `neste-servidor` e `desconhecido` são respostas válidas. */
  paisDeProcessamento: string;
  fonteDoPais: { url: string; consultadoEm: string } | null;
  requiresKey: boolean;
  /** Vozes do provedor; vazia quando o motor não oferece escolha (o simulado). */
  voices: Array<{ id: string; style?: string }>;
  defaultVoice: string | null;
  keyConfigured: boolean;
  /** O último teste da chave em vigor; `null` se ela nunca foi testada. */
  keyCheck: KeyCheck | null;
  priceCheckedOn: string;
  priceSource: string;
}

export interface ToolInfo {
  name: string;
  description: string;
}

export type { HealthLine, HealthStatus };
export interface HealthReport {
  worst: HealthStatus;
  checks: HealthLine[];
}

export interface PanelNotification {
  id: string;
  callId: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface OutboundPolicy {
  enabled: boolean;
  purpose: string | null;
  legalBasis: string | null;
  dailyCapPerLine: number;
  windowStart: string;
  windowEnd: string;
  maxAttemptsPerContact: number;
  timezone: string;
}

export interface Costs {
  from: string;
  to: string;
  totalCents: number;
  byDay: Array<{ day: string; costCents: number; seconds: number }>;
  byAgent: Array<{ agentId: string | null; name: string | null; costCents: number; calls: number }>;
  byEngine: Array<{ engine: string; label: string; costCents: number; seconds: number; priceCheckedOn: string | null; priceSource: string | null }>;
}

export interface Setting<T> {
  key: string;
  value: T | null;
}
