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
  /** O nome da organização; a tela do agente o mostra no texto padrão da mensagem para quem ligou. */
  organizationName?: string;
  /** O idioma da organização (`organizations.language`): o que o agente novo e o menu novo propõem. Nulo: pt-BR. */
  organizationLanguage?: "pt-BR" | "en" | "es" | null;
  /** Se a conta administra a instalação (`isInstallationAdmin`, seção 3.2 do desenho do R8). */
  installationAdmin?: boolean;
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
  /** Ninguém atendeu a transferência: a ligação volta para o agente. Agente gravado antes do campo existir pode chegar sem ele: vale `true`. */
  transferReturnsToAgent?: boolean;
  /** O "ainda está aí?" quando quem ligou fica calado. Agente gravado antes do campo existir pode chegar sem ele: vale `true`. */
  callerIdleGuard?: boolean;
  followUpOwnerUserId: string | null;
  /** Onde quem liga costuma estar. Agente gravado antes do campo existir pode chegar sem ele: vale `normal`. */
  listeningEnvironment?: ListeningEnvironment;
  /** Nomes e termos que o agente deve esperar ouvir. Vazio: nenhum. */
  vocabulary?: string[];
  /** Para quem o agente pode passar a ligação (`transfer_to_agent`). Vazia de fábrica. */
  agentHandoffTargets?: string[];
  /**
   * O que acontece quando a ligação cai. O banco aceita quatro modos; a tela oferece `off`, `task` e
   * `whatsapp`. Agente gravado antes do campo existir pode chegar sem ele: vale `off`.
   */
  dropFollowUp?: DropFollowUp;
  /** O texto do WhatsApp para quem ligou; nulo vale o padrão. */
  dropFollowUpMessage?: string | null;
  /** O analista ao vivo do agente (R6); nulo é "Nenhum", o de fábrica. */
  analystId?: string | null;
}

/** Uma objeção do analista: a `key` é o que os eventos guardam; o rótulo e a orientação são do operador. */
export interface AnalystObjection {
  key: string;
  label: string;
  guidance: string;
}

/** O analista ao vivo (desenho R6, seção 3.1), como `/analysts` devolve. */
export interface Analyst {
  id: string;
  name: string;
  decisionModel: string;
  temperature: boolean;
  objections: AnalystObjection[];
  providerConfirmedBy: string | null;
  /** O nome de hoje de quem confirmou o envio ao fornecedor; nulo se a pessoa saiu da equipe. */
  providerConfirmedByName: string | null;
  providerConfirmedAt: string | null;
}

export type ListeningEnvironment = "normal" | "noisy";
export type DropFollowUp = "off" | "task" | "whatsapp" | "call_back";

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
  /** Atendida pela caixa postal (decisão 0018): não há pessoa do time na linha. */
  voicemail: boolean;
  costCeilingCents?: number | null;
}

/** Uma linha da lista de Chamadas: as contagens do extrato da ligação vêm ao lado do valor, como no detalhe. */
export interface CallListItem extends Call {
  /** Quantas linhas do extrato da ligação não têm custo medido: com alguma, o zero não é grátis. */
  unmeasuredCount: number;
  /** Quantas linhas do extrato da ligação têm custo estimado: com alguma, o valor inclui uma estimativa. */
  estimatedCount: number;
}

/** O detalhe de uma chamada: a análise inteira, que a lista não traz. */
export interface CallDetail extends Call {
  /** Lida com `storedCallAnalysisSchema`; `null` também quando não pôde ser lida. */
  analysis: StoredCallAnalysis | null;
  /** Havia análise gravada, mas fora da forma: a tela diz isso em vez de mostrar a seção. */
  analysisUnreadable: boolean;
  /** O resumo saiu com o prazo de guarda (`calls.summary` virou marcador). */
  summaryPurged: boolean;
  /** O conteúdo saiu a pedido do titular (`calls.erased_at`). */
  erased: boolean;
  /** A ligação que caiu, quando esta é a religação dela (`calls.call_back_of`); nula nas outras. */
  callBackOf: string | null;
  /** Quando a ligação original começou; nula se ela não é vista. */
  callBackOfStartedAt: string | null;
  /** O custo de cada agente da ligação, na ordem em que gastou; `name: null` é agente apagado. A tela mostra com mais de um. */
  costByAgent: Array<{ agentId: string | null; name: string | null; costCents: number; unmeasuredCount: number; estimatedCount: number }>;
  /**
   * O custo de cada peça do pipeline (fatia 5c), na ordem transcrição, cérebro e voz; vazia na ligação do
   * motor direto. `lines: 0` é a peça sem linha no extrato: a tela a mostra como não medida, nunca zero.
   * `label` é o nome da peça instalada; `model`, o único modelo que ela usou na ligação.
   */
  costByPiece: Array<{ piece: string; id: string | null; label: string | null; model: string | null; costCents: number; lines: number; unmeasuredCount: number; estimatedCount: number }>;
  /** Quantas linhas do extrato da ligação não têm custo medido (modelo sem preço, ou consumo que não pôde ser medido): com alguma, o zero não é grátis. */
  unmeasuredCount: number;
  /** Quantas linhas do extrato da ligação têm custo estimado: com alguma, o valor inclui uma estimativa. */
  estimatedCount: number;
}

/** O bloco "Este número" da tela da chamada (`GET /calls/:id/caller-history`). `phone: null`: a chamada não tem número, e o bloco não aparece. */
export interface CallerHistory {
  phone: string | null;
  callCount: number;
  simulatedCallCount: number;
  calls: Array<{
    id: string;
    startedAt: string;
    agentName: string | null;
    direction: "inbound" | "outbound";
    status: CallStatus;
    outcome: string | null;
    summary: string | null;
    summaryPurged: boolean;
    erased: boolean;
    simulated: boolean;
  }>;
  openFollowUpCount: number;
  simulatedOpenFollowUpCount: number;
  openFollowUps: Array<{ id: string; callId: string | null; title: string; dueAt: string; ownerName: string | null; simulated: boolean }>;
  noteCount: number;
  simulatedNoteCount: number;
  notes: Array<{ id: string; callId: string; text: string; createdAt: string; simulated: boolean }>;
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
  /** Endereços extras de onde as ligações chegam, além do `host` (nos dois modos). */
  matchExtra: string[];
  /** Destino das ligações de saída, quando difere do `host`; `null` vale o `host`. */
  outboundHost: string | null;
  /**
   * De quais endereços a central aceita a ligação desta linha, como o processo de voz calculou e
   * gravou. O painel nunca resolve nome: mostra o que está aqui. Vazio na linha ainda não aplicada
   * ou deixada de fora da configuração.
   */
  inboundAllowed: string[];
  /** Quando o conjunto mudou pela última vez (o que a tela mostra quando o `host` é nome). */
  inboundResolvedAt: string | null;
  /**
   * Se o filtro de entrada vale para a linha (R14, contrato 11). Começa desligado só na linha por
   * registro que já existia antes do filtro; a linha por IP filtra sempre.
   */
  inboundFilter: boolean;
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
  /** `ai`: atende o agente. `ivr`: atende o menu por teclas `ivrMenuId`. */
  mode?: "ai" | "ivr";
  ivrMenuId?: string | null;
}

export interface IvrOption {
  digit: string;
  label: string;
  action: "agent" | "transfer" | "hangup";
  agentId: string | null;
  transferTo: string | null;
}

/** Um menu por teclas como a API o lê: nunca o áudio, só a duração do anúncio. */
export interface IvrMenu {
  id: string;
  name: string;
  language: "pt-BR" | "en" | "es";
  timeoutMs: number;
  maxAttempts: number;
  onNoChoice: "person" | "hangup";
  promptAudioMs: number | null;
  updatedAt: string;
  options: IvrOption[];
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
  /** O motor aceita endpoint e modelo próprios na classificação (provedor compatível com OpenAI). */
  classifyTarget: boolean;
  /** O endpoint da classificação gravado, ou `null` para o do motor. */
  baseUrl: string | null;
  /** O modelo da classificação gravado, ou `null` para o do motor. */
  classifyModel: string | null;
  /** O modelo gravado, sem endpoint, não está na tabela de preço: a classificação usa o do motor. */
  classifyModelUnmeasured: boolean;
  /** O endpoint da classificação tem a chave dele gravada (o valor nunca chega à tela). */
  classifyKeyConfigured: boolean;
  /** Vozes do provedor; vazia quando o motor não oferece escolha (o simulado). */
  voices: EngineVoice[];
  defaultVoice: string | null;
  keyConfigured: boolean;
  /** O último teste da chave em vigor; `null` se ela nunca foi testada. */
  keyCheck: KeyCheck | null;
  priceCheckedOn: string;
  priceSource: string;
  /**
   * Só o pipeline (fatia 5b-1): o motor que monta as peças de `agents.pipeline`. Nunca é o motor de um
   * agente: a tela o mostra desligado, e a API recusa gravá-lo em `engine`.
   */
  assembled?: true;
  /** Só no pipeline: por que ele está desligado neste servidor, ou `null` quando a pasta já tem o que falta. */
  unavailable?: { reason: "no_live_transcriber" | "no_transcriber_key" } | null;
}

/** Os motores que um agente pode ter em `engine`: todos menos o pipeline, que monta as peças (fatia 5b-1). */
export const agentEngines = (engines: readonly Engine[] | undefined): Engine[] => (engines ?? []).filter((engine) => engine.assembled !== true);

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
  /** Só o aviso de atualização tem assunto; o sino dá a ele o link para quem administra a instalação. */
  subject: "installation_update" | null;
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
  /** Quantas linhas do extrato do período não têm custo medido; cada soma abaixo leva a sua. Com alguma, o valor ali não é o gasto inteiro. */
  unmeasuredCount: number;
  /** Quantas linhas do extrato do período têm custo estimado; cada soma abaixo leva a sua. A estimativa entra no valor, acima do real. */
  estimatedCount: number;
  byDay: Array<{ day: string; costCents: number; billedSeconds: number; unmeasuredCount: number; estimatedCount: number }>;
  byAgent: Array<{ agentId: string | null; name: string | null; costCents: number; calls: number; unmeasuredCount: number; estimatedCount: number }>;
  /**
   * `source` é `analyst` na linha do analista ao vivo (R6), separada do mesmo modelo usado pelo filtro
   * da fala, e `test` na do teste do agente (fatia 7b), separada do mesmo motor nas ligações. `piece` é
   * a peça do pipeline da linha (fatia 5c), com `label` o nome dela; nula nas outras.
   */
  byEngine: Array<{ engine: string; source: "analyst" | "test" | null; piece: "transcriber" | "brain" | "synthesizer" | null; label: string; costCents: number; callSeconds: number; priceCheckedOn: string | null; priceSource: string | null; unmeasuredCount: number; estimatedCount: number }>;
}

export interface Setting<T> {
  key: string;
  value: T | null;
}

/** Um grupo de turnos do pipeline medidos num agente (fatia 5c). */
export interface PipelineLatencyGroup {
  turns: number;
  calls: number;
  /** A mediana do `totalMs` (do fim da fala de quem ligou ao primeiro áudio do agente), em ms. */
  p50Ms: number;
}

/** `GET /agents/{id}/pipeline-latency`: quanto o pipeline leva para responder neste agente, nas últimas ligações. */
export interface PipelineLatency {
  recentCalls: number;
  /** A meta da mediana por turno sem ferramenta (seção 3.5 do desenho do pipeline). */
  goalP50Ms: number;
  /** Os turnos sem ferramenta: é a eles que a meta vale. Nulo sem turno medido. */
  withoutTool: PipelineLatencyGroup | null;
  /** Os turnos em que a resposta veio depois de uma ferramenta, à parte: o tempo dela entra no total. */
  withTool: PipelineLatencyGroup | null;
}

/** Uma ferramenta de um servidor MCP: como a busca trouxe, com as marcas do operador. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  fingerprint: string;
  supported: boolean;
  allowed: boolean;
  writes: boolean;
  /** Só dica do servidor; nunca decide `writes`. */
  readOnlyHint?: boolean;
}

/** Um servidor MCP como `GET /mcp-servers` devolve. Do segredo, só se existe. */
export interface McpServer {
  slug: string;
  label: string;
  url: string;
  headerName: string;
  secret: { configured: boolean };
  timeoutSeconds: number;
  fetchedAt: string;
  tools: McpTool[];
  /** Os agentes que usam ferramenta deste servidor, pelo nome. */
  agents: Array<{ id: string; name: string; tools: string[] }>;
}

/** O que a descoberta e a busca de novo devolvem. */
export interface McpLookup {
  tools: Array<Omit<McpTool, "allowed" | "writes"> & { allowed?: boolean; writes?: boolean }>;
  omitted: number;
  incomplete: boolean;
  /** Só na busca de novo: o que mudou por ferramenta. */
  changes?: Array<{ name: string; change: "new" | "changed" | "gone" | "same" }>;
}
