// Só tipos: o compilador os apaga, e nada do servidor chega ao navegador.
import type { StoredCallAnalysis } from "@deskvoice/core";
import type { EngineVoice, ProcessingLocation } from "@deskvoice/voice-engine";
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
  followUpOwnerUserId: string | null;
  /** Onde quem liga costuma estar. Agente gravado antes do campo existir pode chegar sem ele: vale `normal`. */
  listeningEnvironment?: ListeningEnvironment;
}

export type ListeningEnvironment = "normal" | "noisy";

export type CallStatus = "ringing" | "in_progress" | "transferred" | "completed" | "failed" | "refused";
export interface Call {
  id: string;
  agentId: string | null;
  agentName: string | null;
  direction: "inbound" | "outbound";
  /** Por onde chegou: linha telefônica, navegador, WhatsApp ou a simulada do botão da tela de Chamadas. */
  channel: "phone" | "web" | "whatsapp" | "simulated";
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
  /** O desfecho comercial, quando alguém leu a conversa. `null` = não classificado. */
  outcome: string | null;
  /** Veio do banco como `numeric`: é string, não número. */
  outcomeConfidence: string | null;
  /** A fala que sustenta o desfecho. */
  outcomeEvidence: string | null;
  /** A nota de 0 a 10, soma da régua (`scoreOf`). `null` = sem análise. */
  analysisScore: number | null;
  costCeilingCents?: number | null;
}

/** O detalhe de uma chamada: a análise inteira, que a lista não traz. */
export interface CallDetail extends Call {
  /** Lida com `storedCallAnalysisSchema`; `null` também quando não pôde ser lida. */
  analysis: StoredCallAnalysis | null;
  /** Havia análise gravada, mas fora da forma: a tela diz isso em vez de mostrar a seção. */
  analysisUnreadable: boolean;
  /** O conteúdo saiu a pedido do titular (`calls.erased_at`). */
  erased: boolean;
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
  provider: string;
  processingLocation: ProcessingLocation;
  requiresKey: boolean;
  /** Vozes do provedor; vazia quando o motor não oferece escolha (o simulado). */
  voices: EngineVoice[];
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
  followUpId: string | null;
  followUpTitle: string | null;
  followUpStatus: FollowUpStatus | null;
}

export type FollowUpStatus = "open" | "done" | "canceled";
export interface FollowUp {
  id: string;
  callId: string | null;
  caller: string | null;
  title: string;
  details: string;
  ownerUserId: string | null;
  ownerName: string | null;
  dueAt: string;
  /** Quando ela passa a ser vencida: um dia depois do prazo (regra do núcleo, calculada no servidor). */
  overdueAt: string;
  status: FollowUpStatus;
  closedAt: string | null;
  closedBy: string | null;
  closedByName: string | null;
  closingNote: string | null;
  createdAt: string;
  /** Quem está na tela pode trocar o dono e fechar (operador: as próprias e as da equipe). */
  canChange: boolean;
}
export interface FollowUpList {
  items: FollowUp[];
  retentionDays: number | null;
  /** Só na lista de uma ligação (`?callId=`): os nomes que os eventos de pendência citam. */
  people?: Person[];
}
export interface Person {
  id: string;
  name: string;
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
