import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { encryptSecret, withSystem, type Clock, type Db } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { createSimulatedEngine, SIMULATED_PREFIX, type SimulatedScript, type VoiceEngine, type VoiceSession, type VoiceSessionConfig, type VoiceSessionEvents } from "@deskvoice/voice-engine";
import { createOrganization } from "../../../../packages/core/test/helpers";
import { secretKey, t0 } from "../../../../packages/tools/test/helpers";
import { createApprovalWaiter, type ApprovalWaiter } from "../approvals";
import type { AriClient, AriEvent, OriginateParams } from "../ari";
import type { CallSessionDeps } from "../call-session";
import type { Logger } from "../log";
import type { CallTransport, Schedule } from "../transport";

export { createOrganization, secretKey, t0 };

/** Relógio de parede falso, que o teste adianta. Vive em 2030, como os testes das ferramentas. */
export function fakeClock(start: Date = t0): Clock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
  };
}

/**
 * Agendador de teste. Timer curto (a cadência de 20 ms do áudio) roda no próximo ciclo e adianta
 * o relógio monotônico falso; timer longo (prazo de aprovação, duração máxima, despedida) fica
 * guardado até o teste dispará-lo com `fire(delayMs)`. Nada espera tempo real.
 */
export function testSchedule(): { schedule: Schedule; now: () => number; fire(delayMs: number): number; held(): number[] } {
  let monotonic = 0;
  let held: Array<{ delayMs: number; fn: () => void }> = [];
  return {
    now: () => monotonic,
    schedule(fn, delayMs) {
      if (delayMs <= 100) {
        const timer = setImmediate(() => {
          monotonic += delayMs;
          fn();
        });
        return () => clearImmediate(timer);
      }
      const entry = { delayMs, fn };
      held.push(entry);
      return () => {
        held = held.filter((candidate) => candidate !== entry);
      };
    },
    fire(delayMs) {
      const due = held.filter((entry) => entry.delayMs === delayMs);
      held = held.filter((entry) => entry.delayMs !== delayMs);
      for (const entry of due) entry.fn();
      return due.length;
    },
    held: () => held.map((entry) => entry.delayMs),
  };
}

export interface AgentOptions {
  script?: SimulatedScript;
  instructions?: string;
  greeting?: string | null;
  engine?: string;
  tools?: string[];
  transferTo?: string | null;
  enabled?: boolean;
  maxCallSeconds?: number;
  costCeilingCents?: number;
  vocabulary?: string[];
}

export async function createAgent(app: Db, organizationId: string, options: AgentOptions = {}): Promise<string> {
  const id = randomUUID();
  const instructions = options.script ? SIMULATED_PREFIX + JSON.stringify(options.script) : (options.instructions ?? "Você é a recepção.");
  await withSystem(app, (q) =>
    q.exec(
      `insert into agents (id, organization_id, name, instructions, greeting, engine, tools, transfer_to_e164, enabled, max_call_seconds, cost_ceiling_cents, vocabulary)
       values ($1, $2, 'Recepção', $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, '{}'::text[]))`,
      [id, organizationId, instructions, options.greeting ?? null, options.engine ?? "simulated", options.tools ?? [], options.transferTo ?? null, options.enabled ?? true, options.maxCallSeconds ?? 600, options.costCeilingCents ?? 500, options.vocabulary ?? null],
    ),
  );
  return id;
}

export async function createTrunk(
  app: Db,
  organizationId: string,
  options: { host?: string; username?: string | null; password?: string | null; authMode?: "register" | "ip"; callerId?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  const password = options.password === undefined ? "s3nha-do-tronco" : options.password;
  await withSystem(app, (q) =>
    q.exec("insert into trunks (id, organization_id, name, host, username, secret_enc, auth_mode, caller_id_e164) values ($1, $2, 'Operadora', $3, $4, $5, $6, $7)", [
      id,
      organizationId,
      options.host ?? "sip.operadora.example",
      options.username === undefined ? "conta100" : options.username,
      password === null ? null : encryptSecret(password, secretKey),
      options.authMode ?? "register",
      options.callerId ?? null,
    ]),
  );
  return id;
}

export async function createPhoneNumber(app: Db, organizationId: string, trunkId: string, e164: string, agentId: string | null): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) => q.exec("insert into phone_numbers (id, organization_id, trunk_id, e164, agent_id) values ($1, $2, $3, $4, $5)", [id, organizationId, trunkId, e164, agentId]));
  return id;
}

export async function createCall(app: Db, organizationId: string, agentId: string, at: Date, direction: "inbound" | "outbound" = "inbound"): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into calls (id, organization_id, agent_id, direction, channel, status, started_at) values ($1, $2, $3, $4, 'phone', 'ringing', $5)", [id, organizationId, agentId, direction, at]),
  );
  return id;
}

export interface CallRow {
  status: string;
  end_reason: string | null;
  engine: string | null;
  cost_cents: number;
  answered_at: Date | null;
  ended_at: Date | null;
  agent_id: string | null;
  from_e164: string | null;
  to_e164: string | null;
  direction: string;
  channel: string;
}

export const callOf = async (app: Db, callId: string): Promise<CallRow> => {
  const row = await withSystem(app, (q) =>
    q.one<CallRow>("select status, end_reason, engine, cost_cents, answered_at, ended_at, agent_id, from_e164, to_e164, direction, channel from calls where id = $1", [callId]),
  );
  if (!row) throw new Error(`Call ${callId} not found`);
  return row;
};

export const callsOf = (app: Db, organizationId: string): Promise<Array<CallRow & { id: string }>> =>
  withSystem(app, (q) =>
    q.many("select id, status, end_reason, engine, cost_cents, answered_at, ended_at, agent_id, from_e164, to_e164, direction from calls where organization_id = $1 order by started_at, id", [organizationId]),
  );

export const eventsOf = (app: Db, callId: string): Promise<Array<{ kind: string; payload: Record<string, unknown> }>> =>
  withSystem(app, (q) => q.many("select kind, payload from call_events where call_id = $1 order by id", [callId]));

export const kindsOf = async (app: Db, callId: string): Promise<string[]> => (await eventsOf(app, callId)).map((event) => event.kind);

export const ledgerOf = (app: Db, callId: string): Promise<Array<{ engine: string; seconds: number; input_tokens: number; output_tokens: number; cost_cents: number }>> =>
  withSystem(app, (q) => q.many("select engine, seconds, input_tokens, output_tokens, cost_cents from usage_ledger where call_id = $1 order by at, cost_cents", [callId]));

export const approvalsOf = (app: Db, callId: string): Promise<Array<{ id: string; status: string; question: string }>> =>
  withSystem(app, (q) => q.many("select id, status, question from approvals where call_id = $1", [callId]));

/** Decide a aprovação por fora da chamada, como o painel faz. */
export const decideApproval = (app: Db, approvalId: string, decision: "approved" | "denied", at: Date): Promise<number> =>
  withSystem(app, (q) => q.exec("update approvals set status = $2, decided_at = $3 where id = $1 and status = 'pending'", [approvalId, decision, at]));

export interface FakeAri extends AriClient {
  /** Cada chamada REST feita, como `verbo argumento...`. */
  log: string[];
  originated: OriginateParams[];
  emit(event: AriEvent): void;
  connect(): void;
  endpoints: Array<{ resource: string; state?: string }>;
  /** Como um Asterisk que consegue ler o arquivo de troncos: lista os endpoints que estão nele. */
  loadsFile?: string;
  failing: boolean;
}

export function fakeAri(): FakeAri {
  const eventHandlers: Array<(event: AriEvent) => void> = [];
  const connectedHandlers: Array<() => void> = [];
  const record = async (line: string): Promise<void> => {
    if (ari.failing) throw new Error("ARI is down");
    ari.log.push(line);
  };
  const ari: FakeAri = {
    log: [],
    originated: [],
    endpoints: [],
    failing: false,
    hangup: (channelId, reason) => record(`hangup ${channelId}${reason ? ` ${reason}` : ""}`),
    setVariable: (channelId, name, value) => record(`set ${channelId} ${name}=${value}`),
    continueDialplan: (channelId, context, extension) => record(`continue ${channelId} ${context},${extension}`),
    async originate(params) {
      await record(`originate ${params.endpoint}`);
      ari.originated.push(params);
    },
    reloadModule: (name) => record(`reload ${name}`),
    async listEndpoints() {
      if (ari.failing) throw new Error("ARI is down");
      if (ari.loadsFile === undefined) return ari.endpoints;
      const conf = await readFile(ari.loadsFile, "utf8");
      return [...conf.matchAll(/^\[(trunk-[0-9a-f-]{36})\]$\ntype=endpoint/gm)].map((match) => ({ resource: match[1] ?? "", state: "unknown" }));
    },
    status: () => (ari.failing ? { connected: false, detail: "ARI is down" } : { connected: true, detail: "Connected." }),
    onEvent: (handler) => void eventHandlers.push(handler),
    onConnected: (handler) => void connectedHandlers.push(handler),
    start: () => undefined,
    close: () => undefined,
    emit(event) {
      for (const handler of eventHandlers) handler(event);
    },
    connect() {
      for (const handler of connectedHandlers) handler();
    },
  };
  return ari;
}

/** O lado de telefonia nas mãos do teste: ele faz o papel de quem ligou. */
export interface ManualTransport extends CallTransport {
  sentBytes: number;
  cleared: number;
  hangups: number;
  closes: number;
  transferredTo: string | null;
  /** Teclas que a conversa mandou apertar. */
  sentDtmf: string[];
  callerAudio(ms: number): void;
  callerHangup(): void;
}

export function manualTransport(): ManualTransport {
  let audio: ((pcm: Buffer) => void) | undefined;
  let hangup: (() => void) | undefined;
  const transport: ManualTransport = {
    sentBytes: 0,
    cleared: 0,
    hangups: 0,
    closes: 0,
    transferredTo: null,
    sentDtmf: [],
    onAudio: (handler) => void (audio = handler),
    sendAudio: (pcm) => void (transport.sentBytes += pcm.length),
    clearAudio: () => void (transport.cleared += 1),
    onHangup: (handler) => void (hangup = handler),
    hangup: async () => void (transport.hangups += 1),
    transfer: async (to) => void (transport.transferredTo = to),
    sendDtmf: async (digits) => void transport.sentDtmf.push(digits),
    close: async () => void (transport.closes += 1),
    callerAudio(ms) {
      for (let sent = 0; sent < ms; sent += 20) audio?.(Buffer.alloc(320));
    },
    callerHangup: () => hangup?.(),
  };
  return transport;
}

/** Motor de voz nas mãos do teste: ele emite os eventos e vê o que a conversa pediu. */
export interface ManualEngine {
  engine: VoiceEngine;
  configs: VoiceSessionConfig[];
  keys: string[];
  said: string[];
  toolResults: Array<{ id: string; result: unknown }>;
  audioBytes: number;
  closed: number;
  emit<K extends keyof VoiceSessionEvents>(event: K, ...args: Parameters<VoiceSessionEvents[K]>): void;
}

export function manualEngine(options: { id?: string; centsPerMinute?: number; keyless?: boolean; connectError?: string | Error; connectHangs?: boolean } = {}): ManualEngine {
  const handlers = new Map<string, Array<(...args: never[]) => void>>();
  const manual: ManualEngine = {
    configs: [],
    keys: [],
    said: [],
    toolResults: [],
    audioBytes: 0,
    closed: 0,
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) (handler as (...values: unknown[]) => void)(...args);
    },
    engine: {
      id: options.id ?? "manual",
      label: "Motor de teste",
      provider: "test",
      processingLocation: { kind: "this-server" },
      keyless: options.keyless ?? false,
      pricing: { centsPerMinute: options.centsPerMinute ?? 100, checkedOn: "2030-05-10", source: "teste" },
      async connect(config, apiKey) {
        manual.configs.push(config);
        manual.keys.push(apiKey);
        if (options.connectError) throw typeof options.connectError === "string" ? new Error(options.connectError) : options.connectError;
        // O provedor aceitou a conexão e ficou mudo: o `connect` nunca volta.
        if (options.connectHangs) await new Promise(() => undefined);
        const session: VoiceSession = {
          on: (event, handler) => void handlers.set(event, [...(handlers.get(event) ?? []), handler as (...args: never[]) => void]),
          sendAudio: (pcm) => void (manual.audioBytes += pcm.length),
          sendToolResult: (id, result) => void manual.toolResults.push({ id, result }),
          say: (text) => void manual.said.push(text),
          close: async () => void (manual.closed += 1),
        };
        return session;
      },
      checkKey: async () => ({ result: "accepted" }),
    },
  };
  return manual;
}

/** O motor simulado com preço, para o custo da chamada de teste não ser zero. */
export const pricedSimulatedEngine = (centsPerMinute: number): VoiceEngine => ({ ...createSimulatedEngine(), pricing: { centsPerMinute, checkedOn: "2030-05-10", source: "teste" } });

/** Quanto o motor simulado conta de fala para um texto: 50 ms por caractere, em quadros de 20 ms. */
export const simulatedSpeechMs = (text: string): number => Math.max(1, Math.ceil((text.length * 50) / 20)) * 20;

export interface SessionHarness {
  deps: CallSessionDeps;
  approvals: ApprovalWaiter;
  clock: ReturnType<typeof fakeClock>;
  timers: ReturnType<typeof testSchedule>;
  logs: Array<{ level: string; message: string; fields?: Record<string, unknown> }>;
}

export async function sessionHarness(app: Db, engines: VoiceEngine[] = [pricedSimulatedEngine(60)]): Promise<SessionHarness> {
  const clock = fakeClock();
  const timers = testSchedule();
  const logs: SessionHarness["logs"] = [];
  const log: Logger = (level, message, fields) => void logs.push({ level, message, fields });
  const approvals = await createApprovalWaiter(app, { schedule: timers.schedule, log });
  const deps: CallSessionDeps = { db: app, clock, engines: new Map(engines.map((engine) => [engine.id, engine])), tools: await loadTools(), secretKey, approvals, schedule: timers.schedule, log };
  return { deps, approvals, clock, timers, logs };
}
