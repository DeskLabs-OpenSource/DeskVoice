import { fill } from "../i18n/locales";
import ptBR, { type HealthAction, type HealthReason } from "../i18n/pt-BR/health";
import type { KeyCheckView } from "./engine-key";
import { AGENT_SILENT_MINUTES } from "./update";
import type { VoiceHealth } from "./voice";
import type { WhatsAppView } from "./whatsapp";
import type { WhatsAppCallsView } from "./whatsapp-calls";

/**
 * A saúde que o painel confere de dentro: uma função por linha, cada uma pura sobre o que a rota
 * leu. Quem lê (banco, processo de voz, WAHA) é a rota; aqui só se decide o estado.
 *
 * A ordem é a de quem procura um defeito, de fora para dentro, e é uma decisão de produto: por
 * isso é uma lista escrita aqui, e não descoberta por pasta. Linha nova é peça nova do sistema
 * (contêiner, ligação), que já pede mudança no Compose e no `install/healthcheck.sh`.
 */
export const HEALTH_ORDER = ["panel", "database", "voice", "telephony", "routines", "agent", "trunk", "engine", "whatsapp", "whatsapp_calls"] as const;
export type HealthId = (typeof HEALTH_ORDER)[number];
export type HealthStatus = "ok" | "warn" | "fail";
type Params = Record<string, string | number>;

/** Em falha, o "o que fazer" é obrigatório: `fail` só aceita motivo que tem ação no dicionário. */
export interface HealthCheck {
  status: HealthStatus;
  reason: HealthReason;
  params: Params;
  action: HealthAction | null;
}
export interface HealthLine extends HealthCheck {
  id: HealthId;
  /** A frase em pt-BR, para quem lê pelo terminal (`install/healthcheck.sh`). A tela usa `reason`. */
  detail: string;
}

const actionOf = (reason: HealthReason): HealthAction | null => (reason in ptBR.actions ? (reason as HealthAction) : null);
const ok = (reason: HealthReason, params: Params = {}): HealthCheck => ({ status: "ok", reason, params, action: null });
const warn = (reason: HealthReason, params: Params = {}): HealthCheck => ({ status: "warn", reason, params, action: actionOf(reason) });
const fail = (reason: HealthReason & HealthAction, params: Params = {}): HealthCheck => ({ status: "fail", reason, params, action: reason });

/**
 * Fila atrasada e fila parada. Cada rotina leva no máximo uns 10 s (o prazo das chamadas de rede
 * do WAHA e do webhook), e o processo pega uma tarefa vencida em instantes: esperar 2 minutos é
 * uma dúzia de tarefas na frente, o que só acontece num pico. Dez minutos é o mesmo prazo em que
 * o próprio processo de rotinas dá por abandonada uma tarefa em execução.
 */
export const ROUTINES_LATE_MINUTES = 2;
export const ROUTINES_STUCK_MINUTES = 10;

const minutes = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / 60_000;

export const panelLine = (): HealthCheck => ok("panel_ok");

export const databaseLine = (answered: boolean): HealthCheck => (answered ? ok("database_ok") : fail("database_down"));

/** `null`: o processo de voz não respondeu. */
export const voiceLine = (voice: VoiceHealth | null): HealthCheck => (voice ? ok("voice_ok") : fail("voice_down"));

export function telephonyLine(voice: VoiceHealth | null): HealthCheck {
  if (!voice) return warn("needs_voice");
  return voice.asterisk.status === "ok" ? ok("telephony_ok") : fail("telephony_down");
}

/** `null`: o banco não respondeu. Escuta conta antes da fila: processo morto com a fila vazia também é falha. */
export function routinesLine(queue: { listeners: number; oldestDueAt: Date | null } | null, now: Date): HealthCheck {
  if (!queue) return warn("needs_database");
  if (queue.listeners === 0) return fail("routines_not_listening");
  const waited = queue.oldestDueAt ? minutes(queue.oldestDueAt, now) : 0;
  const when = queue.oldestDueAt?.toISOString() ?? "";
  if (waited >= ROUTINES_STUCK_MINUTES) return fail("routines_stuck", { when });
  if (waited >= ROUTINES_LATE_MINUTES) return warn("routines_late", { when });
  return ok("routines_ok");
}

/**
 * `null`: o banco não respondeu. Nunca é falha: sem o agente a instalação funciona inteira, e a
 * atualização continua pelo terminal (a mesma regra do `install/healthcheck.sh`).
 */
export function agentLine(agent: { lastSeenAt: Date | null } | null, now: Date): HealthCheck {
  if (!agent) return warn("needs_database");
  if (!agent.lastSeenAt) return warn("agent_never");
  const when = agent.lastSeenAt.toISOString();
  return minutes(agent.lastSeenAt, now) > AGENT_SILENT_MINUTES ? warn("agent_silent", { when }) : ok("agent_ok", { when });
}

export function trunkLine(voice: VoiceHealth | null): HealthCheck {
  if (!voice) return warn("needs_voice");
  const total = voice.trunks.length;
  const down = voice.trunks.filter((line) => line.status !== "ok").length;
  if (total === 0) return warn("trunk_none");
  if (down === 0) return ok("trunk_ok");
  return voice.trunks.some((line) => line.status === "fail") ? fail("trunk_down", { down, total }) : warn("trunk_down", { down, total });
}

export interface EngineKeys {
  /** Quantas chaves de motor estão salvas. */
  keys: number;
  /** O último teste de cada chave testada (o teste some quando a chave muda), com o nome do motor. */
  checks: Array<{ engine: string; check: KeyCheckView }>;
}

const KEY_CHECK_LINE: Record<KeyCheckView["result"], "fail" | "warn" | "ok"> = {
  rejected: "fail",
  model_unavailable: "fail",
  no_credit: "fail",
  // Falha, e não aviso: a ligação com esse motor é recusada do mesmo jeito, e não passa sozinha.
  region_unavailable: "fail",
  rate_limited: "warn",
  unreachable: "warn",
  unexpected_response: "warn",
  accepted: "ok",
  not_needed: "ok",
};

/**
 * `null`: o banco não respondeu. Usa o último teste guardado de cada chave, e nunca testa: a
 * conferência roda a cada minuto em cada aba aberta. A pior chave decide; chave nunca testada vale
 * como antes do teste existir (cadastrada é `ok`).
 */
export function engineLine(engines: EngineKeys | null): HealthCheck {
  if (engines === null) return warn("needs_database");
  if (engines.keys === 0) return warn("engine_none");
  const params = ({ engine, check }: EngineKeys["checks"][number]): Params => ({ engine, when: check.checkedAt, model: check.model ?? "" });
  const failed = engines.checks.find(({ check }) => KEY_CHECK_LINE[check.result] === "fail");
  if (failed?.check.result === "rejected") return fail("engine_key_rejected", params(failed));
  if (failed?.check.result === "model_unavailable") return fail("engine_model_unavailable", params(failed));
  if (failed?.check.result === "region_unavailable") return fail("engine_region_unavailable", params(failed));
  if (failed) return fail("engine_no_credit", params(failed));
  const inconclusive = engines.checks.find(({ check }) => KEY_CHECK_LINE[check.result] === "warn");
  if (inconclusive) return warn("engine_check_inconclusive", params(inconclusive));
  const oldest = engines.checks.toSorted((a, b) => a.check.checkedAt.localeCompare(b.check.checkedAt))[0];
  if (!oldest || engines.checks.length < engines.keys) return ok("engine_ok");
  return ok("engine_key_accepted", params(oldest));
}

/**
 * A linha do motor para quem não tem sessão: a rota é pública e soma a instalação inteira, então
 * diz o estado e o que fazer, mas não o provedor, o modelo nem a data, que são de uma organização.
 */
export function anonymousEngineLine(line: HealthCheck): HealthCheck {
  if (line.reason === "engine_key_accepted") return ok("engine_ok");
  if (!("engine" in line.params)) return line;
  return line.status === "fail" ? fail("engine_key_problem") : warn("engine_key_problem");
}

/**
 * O estado que o bloco WhatsApp de Configurações calcula (`observe`). `"down"`: o WAHA não
 * respondeu; `null`: o banco não respondeu. Não instalado é o padrão, e é `ok`; instalado e
 * caído é aviso, porque ligações e o resto do sistema seguem sem ele.
 */
export function whatsappLine(view: WhatsAppView | "down" | null): HealthCheck {
  if (!view) return warn("needs_database");
  if (view === "down") return warn("whatsapp_service_down");
  if (view.service === "absent" || view.service === "removing") return ok("whatsapp_absent");
  if (!view.available) return warn("whatsapp_unavailable");
  if (view.service === "preparing") return ok("whatsapp_preparing");
  if (view.service === "failed") return warn("whatsapp_service_failed");
  if (view.status === "connected") return ok("whatsapp_connected");
  return view.status === "failed" ? warn("whatsapp_dropped") : warn("whatsapp_no_number");
}

/**
 * A ligação pelo WhatsApp, no mesmo molde: não instalado é o padrão e é `ok`; instalado e sem
 * resposta, sem número, ou com o número desconectado é aviso, porque o resto segue sem ele.
 * `"down"`: o processo de voz ou o WaCalls não responderam; `null`: o banco não respondeu.
 */
export function whatsappCallsLine(view: WhatsAppCallsView | "down" | null): HealthCheck {
  if (!view) return warn("needs_database");
  if (view === "down") return warn("whatsapp_calls_service_down");
  if (view.service === "absent" || view.service === "removing") return ok("whatsapp_calls_absent");
  if (!view.available) return warn("whatsapp_calls_unavailable");
  if (view.service === "preparing") return ok("whatsapp_calls_preparing");
  if (view.service === "failed") return warn("whatsapp_calls_service_failed");
  if (view.status === "connected") return view.agentId ? ok("whatsapp_calls_connected") : warn("whatsapp_calls_no_agent");
  return view.status === "failed" ? warn("whatsapp_calls_dropped") : warn("whatsapp_calls_no_number");
}

/** As linhas na ordem de depuração e o pior estado entre elas. Linha ausente (sem sessão) fica de fora. */
export function healthReport(lines: Partial<Record<HealthId, HealthCheck>>): { worst: HealthStatus; checks: HealthLine[] } {
  const checks = HEALTH_ORDER.flatMap((id) => {
    const line = lines[id];
    return line ? [{ id, ...line, detail: fill(ptBR.reasons[line.reason], line.params) }] : [];
  });
  const worst = checks.some((line) => line.status === "fail") ? "fail" : checks.some((line) => line.status === "warn") ? "warn" : "ok";
  return { worst, checks };
}
