import {
  CALL_RECORDING_SETTING,
  CALLER_MEMORY_AGENT_SETTING,
  callerMemoryAgentOf,
  callRecordingOf,
  decryptSecret,
  enqueueTask,
  loadCallerMemory,
  recordEvent,
  recordEventWithId,
  recordingPath,
  rememberedBlock,
  voicemailLanguageSchema,
  type CallerMemory,
  type CallEventKind,
  type CallStatus,
  type Clock,
  type Db,
  type OrgQuery,
  type RememberedItem,
  type VoicemailLanguage,
} from "@deskvoice/core";
import {
  autoCommitOrgQuery,
  handoffTargetsOf,
  MAX_AGENT_HANDOFFS_PER_CALL,
  runTool,
  toSpec,
  toolCalledArgs,
  TRANSFER_TO_AGENT,
  type HandoffOutcome,
  type HandoffTarget,
  type RecordingStop,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "@deskvoice/tools";
import {
  DECISION_DEADLINE_MS,
  DECISION_MODEL_SETTING,
  EngineTimeoutError,
  MICROCENTS_PER_CENT,
  SIMULATED_PREFIX,
  decisionModelKeySetting,
  decisionModelOf,
  estimateCostCents,
  readSpeechDecision,
  speechFilterQuestions,
  speechFilterState,
  type DecisionModel,
  type Usage,
  type VoiceEngine,
  type VoiceSession,
  type VoiceSessionConfig,
} from "@deskvoice/voice-engine";
import type { ApprovalWaiter } from "./approvals";
import { messageOf, silentLogger, type Logger } from "./log";
import { panelNotice } from "./panel-notice";
import { createSilenceGuard, type SilenceGuard } from "./silence-guard";
import { MIN_FREE_BYTES_TO_RECORD, freeBytes, startRecording, type Recording } from "./recording";
import { failureTone, realSchedule, type CallTransport, type Schedule } from "./transport";

/** O áudio do motor é PCM16 mono 8 kHz: 16 bytes por milissegundo de fala. */
const PCM16_8K_BYTES_PER_MS = 16;

export interface CallSessionDeps {
  db: Db;
  clock: Clock;
  engines: Map<string, VoiceEngine>;
  tools: Map<string, Tool>;
  /** Decifra a chave do motor guardada em `settings`. */
  secretKey: Buffer;
  approvals: ApprovalWaiter;
  schedule?: Schedule;
  log?: Logger;
  /** Pasta das gravações (`RECORDINGS_DIR`). Sem ela, ou com a gravação desligada na organização, a chamada não é gravada. */
  recordingsDir?: string;
  /** Espaço livre mínimo na pasta para gravar (padrão `MIN_FREE_BYTES_TO_RECORD`). */
  recordingMinFreeBytes?: number;
  /** Os modelos de decisão instalados (`loadDecisionModels`). Sem eles, o filtro da fala não liga. */
  decisionModels?: Map<string, DecisionModel>;
}

export interface CallSessionInput {
  organizationId: string;
  callId: string;
  agentId: string;
  transport: CallTransport;
  /** O que mais `call_started` deve dizer sobre a origem (a chamada pelo navegador diz o canal e quem ligou). */
  started?: Record<string, unknown>;
  /** A chamada simulada troca o motor, as instruções e as ferramentas do agente pelas do roteiro. */
  overrides?: { engineId?: string; instructions?: string; tools?: string[] };
}

export interface CallOutcome {
  status: CallStatus;
  endReason: string;
  costCents: number;
}

export interface CallSession {
  organizationId: string;
  callId: string;
  /** Resolve quando a chamada terminou e tudo foi gravado. Nunca rejeita. */
  done: Promise<CallOutcome>;
  /** Encerra de fora (o processo está saindo). */
  stop(reason: string): void;
  /**
   * Para a gravação a pedido feito no painel, por `userId`. `call_ended`: a chamada já está
   * encerrando, e não há mais o que pedir a ela.
   */
  stopRecording(userId: string, reason: string | null): Promise<RecordingStop | "call_ended">;
}

interface Ending {
  status: CallStatus;
  endReason: string;
  transferTo?: string;
  /** Quem ligou já desligou: não há a quem esperar a fala terminar. */
  callerGone?: boolean;
  /** Sem motor para falar, quem está na linha ouve o sinal de falha antes de sair. */
  tone?: boolean;
  /** O que precisa estar na linha do tempo antes de `call_ended`. */
  events?: Array<[CallEventKind, object]>;
  /** Aviso para o painel. */
  notice?: string;
}

interface AgentRow {
  id: string;
  name: string;
  instructions: string;
  greeting: string | null;
  engine: string;
  voice_id: string | null;
  language: string;
  tools: string[];
  max_call_seconds: number;
  cost_ceiling_cents: number;
  transfer_to_e164: string | null;
  vocabulary: string[];
  listening_environment: "normal" | "noisy";
  agent_handoff_targets: string[];
}

const AGENT_COLUMNS =
  "id, name, instructions, greeting, engine, voice_id, language, tools, max_call_seconds, cost_ceiling_cents, transfer_to_e164, vocabulary, listening_environment, agent_handoff_targets";

/** Um trecho da ligação: o tempo em que ela esteve com um agente, com o motor e o custo dele. */
interface Leg {
  agent: AgentRow;
  engine: VoiceEngine;
  voice: VoiceSession;
  enabled: Map<string, Tool>;
  guard: SilenceGuard;
  context: ToolContext;
  usage: Required<Pick<Usage, "seconds" | "inputTokens" | "outputTokens" | "textInputTokens" | "cachedInputTokens" | "textOutputTokens">>;
  /** O custo do trecho, calculado com o preço do motor dele. */
  costCents: number;
  /** O último `error` do motor, para explicar um `closed` que venha em seguida. */
  lastError?: Error;
}

export const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;
export const RECORDING_NOTICE_SETTING = "recording_notice.text";
/** O aviso que vale quando o operador não escreveu o dele. Toda chamada começa por um aviso. */
export const DEFAULT_RECORDING_NOTICE = "Esta ligação é atendida por uma assistente virtual e a conversa fica registrada.";
// Além do prazo do próprio motor: nenhum `connect` segura quem ligou em silêncio por mais que isto.
const CONNECT_TIMEOUT_MS = 15_000;

/** A ligação acabou enquanto um motor abria: a abertura desiste sem esperar o prazo. */
class CallEndedError extends Error {}

// Tempo para a despedida ser gerada e chegar à fila de saída; o que estiver na fila ainda toca
// até o fim antes de a ligação cair (`transport.hangup` espera).
const FAREWELL_MS = 6000;
const FAREWELL = {
  maxDuration: "Esta ligação chegou ao tempo máximo e vou precisar encerrar. Se ainda precisar de algo, é só ligar de novo. Obrigado.",
  costCeiling: "Preciso encerrar esta ligação agora. Se ainda precisar de algo, é só ligar de novo. Obrigado.",
  costCeilingTransfer: "Vou passar você para uma pessoa da equipe continuar o atendimento. Um instante, por favor.",
};
const CLOSING_MESSAGE = "A ligação está sendo encerrada. Não chame mais ferramentas.";
const TOOL_CRASH_MESSAGE = "Não consegui concluir isso agora. Diga a quem está na linha que não foi possível concluir neste momento, e ofereça outra forma de ajudar.";

/**
 * O que o agente que recebe a ligação diz primeiro, antes de quem ligou falar. Fixa, e não a saudação
 * do agente: a saudação é para quem acabou de ligar, e esta pessoa já foi atendida. O resto ele tira
 * do motivo e do resumo, que estão nas instruções. Vai no idioma do agente que recebe, nos mesmos
 * idiomas do aviso da caixa postal; um idioma fora do mapa cai no pt-BR.
 */
export const HANDOFF_GREETINGS: Readonly<Record<VoicemailLanguage, string>> = {
  "pt-BR": "Oi, vou continuar o seu atendimento a partir daqui.",
  en: "Hi, I'll take it from here and continue helping you.",
  es: "Hola, voy a continuar con su atención a partir de aquí.",
};

export function handoffGreetingFor(language: string): string {
  const parsed = voicemailLanguageSchema.safeParse(language);
  return HANDOFF_GREETINGS[parsed.success ? parsed.data : "pt-BR"];
}

/** O que entra nas instruções do agente que recebe a ligação: quem passou, o motivo e o resumo. */
export interface HandoffNote {
  fromName: string;
  reason: string;
  summary: string;
}

// Nome e papel do agente vêm da configuração, e não de quem ligou; ainda assim ficam numa linha só,
// para nenhum nome mal digitado abrir um parágrafo nas instruções.
const oneLine = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();

/**
 * As instruções que a sessão entrega ao motor. Sem destino e sem passagem, são as do agente, byte a
 * byte. Com destino, ganham uma linha por agente para quem ele pode passar a ligação, com nome e papel.
 * Com passagem, ganham quem passou e, no bloco delimitado e escapado (`rememberedBlock`, registro
 * 0020), o motivo e o resumo: texto do modelo a partir da fala de quem ligou, que é dado e nunca
 * instrução. Nada do resumo muda a configuração: os destinos e as ferramentas vêm só do banco.
 *
 * Com a memória do número (`memory`, fatia 6: as notas e os títulos de pendência que
 * `loadCallerMemory` montou), os itens entram no mesmo bloco, depois do motivo e do resumo quando há
 * passagem: as instruções nunca têm mais de um bloco. Sem item, nada muda.
 *
 * O roteiro do motor simulado (`simulated:` seguido de JSON) passa intacto: ninguém o lê como
 * instrução, e qualquer texto colado nele quebraria o `JSON.parse` do motor. O teste lê as instruções
 * montadas com um motor que as guarda.
 */
export function composeInstructions(base: string, targets: readonly HandoffTarget[], handoff?: HandoffNote, memory: readonly RememberedItem[] = []): string {
  if (base.startsWith(SIMULATED_PREFIX)) return base;
  const parts = [base];
  if (targets.length > 0) {
    parts.push(
      [
        "Agentes para quem você pode passar a ligação com transfer_to_agent, pelo nome exato:",
        ...targets.map((target) => `- ${oneLine(target.name)}${target.roleLabel?.trim() ? ` (${oneLine(target.roleLabel)})` : ""}`),
      ].join("\n"),
    );
  }
  if (handoff) {
    parts.push(
      [
        `Esta ligação veio do agente ${oneLine(handoff.fromName)}, que já saiu da linha. Quem ligou já ouviu o aviso de gravação e acabou de ouvir você dizer que continua o atendimento. Continue a partir do motivo e do resumo da passagem, sem pedir de novo o que já foi dito.`,
        rememberedBlock([{ label: "motivo", text: handoff.reason }, { label: "resumo", text: handoff.summary }, ...memory]),
      ].join("\n"),
    );
  } else if (memory.length > 0) {
    parts.push(rememberedBlock(memory));
  }
  return parts.join("\n\n");
}

/**
 * `OrgQuery` que executa uma consulta de cada vez, na ordem em que foram pedidas. A linha do tempo
 * é ordenada pelo id do evento, e os eventos de uma chamada nascem de vários lugares ao mesmo
 * tempo (transcrição, ferramenta em espera, medição de custo): sem a fila, a ordem gravada
 * dependeria de qual conexão do pool respondesse primeiro.
 */
function serialQuery(inner: OrgQuery): OrgQuery {
  let tail: Promise<unknown> = Promise.resolve();
  const next = <T>(run: () => Promise<T>): Promise<T> => {
    const result = tail.then(run);
    tail = result.catch(() => undefined);
    return result;
  };
  return {
    organizationId: inner.organizationId,
    // O tipo da linha é só repassado ao `inner`; a asserção devolve o parâmetro genérico que a
    // função de seta perde.
    many: ((sql: string, params?: unknown[]) => next(() => inner.many(sql, params))) as OrgQuery["many"],
    one: ((sql: string, params?: unknown[]) => next(() => inner.one(sql, params))) as OrgQuery["one"],
    exec: (sql, params) => next(() => inner.exec(sql, params)),
  };
}

/**
 * A conversa de uma chamada, do atendimento ao encerramento, sobre qualquer `CallTransport`.
 * A linha em `calls` já existe (quem criou foi a entrada, a saída ou a simulação).
 */
export function startCallSession(deps: CallSessionDeps, input: CallSessionInput): CallSession {
  const { clock } = deps;
  const { organizationId, callId, agentId, transport, overrides } = input;
  // O canal que não transfere (WhatsApp) é lido aqui, num ponto só: o número de transferência do
  // agente deixa de existir para esta chamada, e quem encerra é a despedida.
  const canTransfer = transport.canTransfer !== false;
  const schedule = deps.schedule ?? realSchedule;
  const log: Logger = (level, message, fields) => (deps.log ?? silentLogger)(level, message, { callId, ...fields });

  // Cada consulta confirma na hora: a aprovação pedida aparece no painel enquanto a ferramenta
  // ainda espera a decisão.
  const q = serialQuery(autoCommitOrgQuery(deps.db, organizationId));
  const event = (kind: CallEventKind, payload: object): Promise<void> => recordEvent(q, callId, kind, payload, clock.now());
  const logFailure = (what: string) => (error: unknown) => log("error", what, { error: messageOf(error) });

  /** O agente em que a ligação está agora. Muda numa passagem (`transfer_to_agent`). */
  let agent: AgentRow | undefined;
  let voice: VoiceSession | undefined;
  /** A guarda contra o silêncio (antipadrão 15). Existe a partir de quando o motor conecta. */
  let guard: SilenceGuard | undefined;
  /** O trecho da ligação em curso: um por agente por onde ela passou. */
  let leg: Leg | undefined;
  /** Todos os trechos, o atual inclusive: o custo da ligação é a soma dos custos deles. */
  const legs: Leg[] = [];
  /** Os agentes por onde a ligação passou: os limites da ligação são os menores entre eles. */
  const visited: AgentRow[] = [];
  let handoffs = 0;
  let handingOff = false;
  /**
   * A memória do número que o agente recebe (fatia 6), carregada uma vez no começo: o agente de
   * destino de uma passagem recebe os mesmos itens. `null` com a chave desligada ou sem item.
   */
  let memory: CallerMemory | null = null;
  /**
   * O filtro da fala de quem ligou (R12, fatia 6), lido uma vez no começo, como a memória. Ausente
   * (o de fábrica), nenhum pedido sai e nada muda na linha do tempo.
   */
  let filter: { model: DecisionModel; apiKey: string } | undefined;
  /** A última fala do agente, de qualquer trecho: é o contexto da pergunta "é fala de fundo?". */
  let lastAgentText: string | undefined;
  /** As leituras em voo: o fim da chamada espera por elas (cada uma tem o prazo de 1 s) antes de `call_ended`. */
  const readingsRunning = new Set<Promise<void>>();
  /** O custo do filtro, em micro-centavos: um pedido custa milésimos de centavo. */
  let decisionMicrocents = 0;
  let ending = false;
  let recorder: Recording | undefined;
  /** A gravação já parou a pedido de quem ligou: não volta na mesma chamada. */
  let recordingPaused = false;
  /** A gravação de `recording_failed`, para o fim da chamada esperar por ela. */
  let recordingFailed: Promise<void> | undefined;
  // A sessão já é alcançável pelo painel antes de se saber se ela grava: o pedido de parar espera essa
  // decisão (arquivo aberto ou não), para não responder "não está gravando" e a gravação começar logo
  // depois. O encerramento também resolve, para o pedido nunca ficar pendurado.
  let resolveRecordingDecided: () => void = () => undefined;
  const recordingDecided = new Promise<void>((resolve) => (resolveRecordingDecided = resolve));
  let wrappingUp = false;
  let requestedEnd: Ending | undefined;
  let requestedFarewell: string | undefined;
  let costCents = 0;
  /**
   * O custo da ligação: o da voz, em centavos, mais o do filtro, arredondado uma vez só, no total
   * (a mesma conta de `calls.cost_cents` na classificação). Sem filtro, é o custo da voz, como antes.
   */
  const callCents = (): number => costCents + Math.round(decisionMicrocents / MICROCENTS_PER_CENT);
  /** Os segundos da ligação inteira, somados de todos os trechos (vão em `call_ended`). */
  const usage = { seconds: 0 };
  const cancelTimers: Array<() => void> = [];
  /** O prazo da duração máxima, que uma passagem pode reagendar para mais cedo. */
  let cancelDuration: () => void = () => undefined;
  /** Quando a ligação foi atendida: a duração máxima conta daqui, e uma passagem não zera o relógio. */
  let answeredAt: Date | undefined;
  /** A menor duração máxima entre os agentes por onde a ligação passou, em segundos. */
  let durationLimitSeconds = 0;
  const toolsRunning = new Set<Promise<void>>();
  const callEnded = new AbortController();
  let resolveDone: (outcome: CallOutcome) => void = () => undefined;
  const done = new Promise<CallOutcome>((resolve) => (resolveDone = resolve));

  /** O único encerramento: por qualquer caminho, roda uma vez. */
  async function finish(end: Ending): Promise<void> {
    if (ending) return;
    ending = true;
    guard?.stop();
    resolveRecordingDecided();
    for (const cancel of cancelTimers) cancel();
    cancelDuration();
    // Ferramenta em espera (uma aprovação pendente) é solta, e o resultado dela entra na linha do
    // tempo antes de `call_ended`.
    callEnded.abort(new Error("The call ended before the tool finished"));
    await Promise.allSettled(toolsRunning);
    // A leitura em voo tem prazo de 1 s: o que ela disser entra na linha do tempo antes de `call_ended`.
    await Promise.allSettled(readingsRunning);
    try {
      // Fechar o motor entrega a última medição de uso; ela entra no custo gravado abaixo.
      await voice?.close();
      for (const [kind, payload] of end.events ?? []) await event(kind, payload);
      if (end.notice) await panelNotice(q, clock, callId, end.notice);
      await q.exec("update calls set status = $2, end_reason = $3, ended_at = $4, cost_cents = $5 where id = $1", [callId, end.status, end.endReason, clock.now(), callCents()]);
      await event("call_ended", { status: end.status, reason: end.endReason, costCents: callCents(), seconds: Math.round(usage.seconds) });
      const taskId = await enqueueTask(q, { kind: "summarize_call", payload: {}, callId, runAt: clock.now() });
      await event("task_queued", { taskId, kind: "summarize_call" });
      // O supervisor de regras fixas: sem modelo e sem gasto, abre uma pendência se a ligação terminou sem próximo passo.
      const reviewId = await enqueueTask(q, { kind: "review_call", payload: {}, callId, runAt: clock.now() });
      await event("task_queued", { taskId: reviewId, kind: "review_call" });
    } catch (error) {
      log("error", "could not record the end of the call", { error: messageOf(error) });
    }
    // Quem ligou desligou: a fala do agente que ainda estava na fila não toca mais, e sai da
    // gravação, que é prova do que quem ligou ouviu (issue #109). Nos outros caminhos não: `hangup`
    // e `transfer` esperam a fila tocar antes de soltar (contrato em transport.ts), e a gravação a
    // guarda inteira.
    if (end.callerGone) recorder?.clear();
    // A telefonia é solta mesmo se o banco falhou acima: ninguém fica preso na linha.
    try {
      if (end.tone && !end.callerGone) transport.sendAudio(failureTone());
      if (end.callerGone) await transport.close();
      else if (end.status === "transferred" && end.transferTo) await transport.transfer(end.transferTo);
      else await transport.hangup();
    } catch (error) {
      log("error", "could not release the telephony side", { error: messageOf(error) });
    }
    // Fecha o arquivo em qualquer caminho de fim: com áudio vira `.wav`; sem, ou com falha, o `.part` some.
    const savedRecording = await recorder?.finish().catch((error: unknown) => {
      logFailure("could not save the call recording")(error);
      return undefined;
    });
    // A impressão digital vai para a linha do tempo junto do fim da chamada: com ela se confere se uma
    // cópia do áudio é igual à que esta instalação gravou (não prova nada contra quem administra o
    // servidor). `null` quando não pôde ser calculada: a gravação está salva assim mesmo.
    // A falha do banco aqui não pode impedir o `done`: o arquivo já está salvo, só o registro falta.
    if (savedRecording && savedRecording.sha256Error !== undefined) logFailure("could not compute the recording fingerprint")(savedRecording.sha256Error);
    if (savedRecording) await event("recording_saved", { bytes: savedRecording.bytes, sha256: savedRecording.sha256 }).catch(logFailure("could not record the saved recording"));
    await recordingFailed;
    resolveDone({ status: end.status, endReason: end.endReason, costCents: callCents() });
  }

  /**
   * Abre a gravação, se houver espaço. Sem espaço, ou se a pasta falhar, a chamada segue sem
   * gravar, e a linha do tempo diz por quê: quem ligou e o painel nunca ficam sem resposta.
   */
  async function openRecording(dir: string): Promise<void> {
    const minFreeBytes = deps.recordingMinFreeBytes ?? MIN_FREE_BYTES_TO_RECORD;
    let opened: Recording;
    try {
      const free = await freeBytes(dir);
      if (free < minFreeBytes) return void (await event("recording_skipped", { reason: "low_disk", freeBytes: free, minFreeBytes }));
      opened = await startRecording(recordingPath(dir, organizationId, callId), () => clock.now().getTime(), {
        // A chamada segue sem gravar, e a linha do tempo diz na hora que a gravação parou.
        onFailure: (reason, error) => {
          log("error", "the call recording failed; the call goes on without it", { reason, error: error.message });
          recordingFailed = event("recording_failed", { reason, error: error.message }).catch(logFailure("could not record the recording failure"));
        },
      });
    } catch (error) {
      log("error", "could not start the call recording", { error: messageOf(error) });
      return void (await event("recording_skipped", { reason: "unavailable", error: messageOf(error) }));
    }
    // A chamada pode ter terminado enquanto o arquivo abria: fecha já, e o `.part` vazio some.
    if (ending) await opened.finish();
    else recorder = opened;
  }

  /**
   * Para a gravação a pedido de quem ligou. O trecho já dito — inclusive a frase do pedido — vai para
   * o disco antes de parar: é a prova de que a revogação existiu e de quando ela começou. Do pedido
   * em diante nada mais é gravado, e não há retomada.
   */
  async function pauseRecording(who: { by: "agent" } | { by: "human"; userId: string }, reason: string | null): Promise<RecordingStop | "call_ended"> {
    if (ending) return "call_ended";
    if (recordingPaused) return "already_stopped";
    await recordingDecided;
    if (ending) return "call_ended";
    if (recordingPaused) return "already_stopped";
    // Sem arquivo aberto (gravação desligada, sem espaço) ou com a gravação já interrompida por
    // falha, não há o que parar: nada é registrado, e quem pediu ouve a verdade.
    if (!recorder || recordingFailed) return "not_recording";
    recordingPaused = true;
    await recorder.pause().catch(logFailure("could not stop the call recording"));
    await q.exec("update calls set recording_paused_at = $2, recording_paused_by = $3, recording_pause_reason = $4 where id = $1", [callId, clock.now(), who.by, reason]);
    await event("recording_paused", { ...who, ...(reason !== null && { reason }) });
    return "stopped";
  }

  /** O agente se despede e a chamada termina logo depois. */
  function wrapUp(farewell: string | null, end: Ending): void {
    if (ending || wrappingUp) return;
    wrappingUp = true;
    guard?.stop();
    // Sem texto: o modelo já vai falar a despedida (o resultado da ferramenta pediu), e só se espera.
    if (farewell) voice?.say(farewell);
    cancelTimers.push(schedule(() => void finish(end), FAREWELL_MS));
  }

  /** Teto de custo da ligação: o menor `cost_ceiling_cents` acima de zero entre os agentes por onde ela passou. Zero é "sem teto". */
  function costCeiling(): number {
    const positive = visited.map((row) => row.cost_ceiling_cents).filter((cents) => cents > 0);
    return positive.length === 0 ? 0 : Math.min(...positive);
  }

  /** O número de transferência que vale: o do agente em que a ligação está agora, se o canal transfere. */
  const currentTransferTo = (): string | null => (canTransfer ? (agent?.transfer_to_e164 ?? null) : null);

  /**
   * Confere o teto contra o custo somado da ligação. Alcançado, a despedida começa na hora, sem
   * esperar o banco, e volta o que registrar na linha do tempo.
   */
  function reachCeiling(total: number): { ceiling: number; transferTo: string | null } | undefined {
    const ceiling = costCeiling();
    // Teto zero é "sem teto": com `>=`, zero derrubaria toda chamada na primeira medição.
    if (!(ceiling > 0 && total >= ceiling) || ending || wrappingUp) return undefined;
    const transferTo = currentTransferTo();
    wrapUp(
      transferTo ? FAREWELL.costCeilingTransfer : FAREWELL.costCeiling,
      transferTo ? { status: "transferred", endReason: "cost_ceiling", transferTo } : { status: "completed", endReason: "cost_ceiling" },
    );
    return { ceiling, transferTo };
  }

  async function recordCeiling(total: number, reached: { ceiling: number; transferTo: string | null }): Promise<void> {
    await event("cost_ceiling_reached", { costCents: total, ceilingCents: reached.ceiling });
    if (reached.transferTo) await event("transfer_started", { to: reached.transferTo, reason: "cost_ceiling" });
  }

  async function meter(from: Leg, increment: Usage): Promise<void> {
    usage.seconds += increment.seconds ?? 0;
    from.usage.seconds += increment.seconds ?? 0;
    from.usage.inputTokens += increment.inputTokens ?? 0;
    from.usage.outputTokens += increment.outputTokens ?? 0;
    from.usage.textInputTokens += increment.textInputTokens ?? 0;
    from.usage.cachedInputTokens += increment.cachedInputTokens ?? 0;
    from.usage.textOutputTokens += increment.textOutputTokens ?? 0;
    // Cada trecho é calculado com o preço do motor dele, e o custo da ligação é a soma dos trechos:
    // com dois agentes em motores de preço diferente, um preço só erraria a conta.
    // `usage` é incremento: o custo sai do total somado, e cada linha do extrato leva a diferença.
    // Assim a soma do extrato é sempre o custo da chamada, apesar do arredondamento.
    from.costCents = estimateCostCents(from.engine.pricing, from.usage);
    const total = legs.reduce((sum, each) => sum + each.costCents, 0);
    const delta = total - costCents;
    costCents = total;
    const reached = reachCeiling(callCents());
    await q.exec(
      "insert into usage_ledger (organization_id, call_id, engine, agent_id, seconds, input_tokens, output_tokens, cost_cents, cost_microcents, at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        organizationId,
        callId,
        from.engine.id,
        // O agente do trecho, e não o que atendeu: o custo por agente continua verdadeiro com passagem.
        from.agent.id,
        Math.round(increment.seconds ?? 0),
        (increment.inputTokens ?? 0) + (increment.textInputTokens ?? 0) + (increment.cachedInputTokens ?? 0),
        (increment.outputTokens ?? 0) + (increment.textOutputTokens ?? 0),
        delta,
        // A linha do medidor já é a diferença de dois totais arredondados; o micro-centavo dela é o
        // centavo inteiro, para o extrato somar na mesma unidade do resto (a classificação, que é
        // menor que um centavo).
        delta * MICROCENTS_PER_CENT,
        clock.now(),
      ],
    );
    await q.exec("update calls set cost_cents = $2 where id = $1", [callId, callCents()]);
    if (reached) await recordCeiling(callCents(), reached);
  }

  /**
   * Pergunta ao modelo de decisão sobre uma fala de quem ligou, sem que ninguém espere (desenho R12,
   * "A regra que impede o atraso"). O filtro **só marca e sugere**: o texto gravado nunca muda, e a
   * fala nunca sai da linha do tempo nem do que o motor ouviu. Com resposta, a marca de fundo e a
   * sugestão de leitura que passam do corte ficam presas à própria fala (`read`, ao lado de `text`,
   * e saem com ela no prazo de guarda e no apagamento, que trocam o payload inteiro), e a leitura
   * vira `caller_speech_read` com as confianças e o agente do trecho. O "terminou o pensamento" chega
   * depois do turno (o texto é o final), e por isso é só observação: não toca a guarda contra o
   * silêncio. Sem resposta no prazo, o pedido é cancelado e a linha do tempo diz `late`.
   */
  async function readCallerSpeech(owner: Leg, active: { model: DecisionModel; apiKey: string }, text: string, recorded: Promise<string>): Promise<void> {
    const vocabulary = owner.agent.vocabulary;
    // O texto de quem ligou vai só no `state`. As perguntas são fixas.
    const input = { state: speechFilterState(lastAgentText, text), questions: speechFilterQuestions(text, vocabulary) };
    const askedAt = clock.now().getTime();
    const result = await active.model.decide(active.apiKey, input, { timeoutMs: DECISION_DEADLINE_MS, schedule });
    const latencyMs = clock.now().getTime() - askedAt;
    const common = { agentId: owner.agent.id, model: result.model, latencyMs };
    if (result.costMicrocents > 0 || (result.usage.inputTokens ?? 0) > 0) {
      decisionMicrocents += result.costMicrocents;
      const reached = reachCeiling(callCents());
      // Uma linha por pedido, no agente do trecho, com o id do modelo no lugar do motor.
      await q.exec(
        "insert into usage_ledger (organization_id, call_id, engine, agent_id, seconds, input_tokens, output_tokens, cost_cents, cost_microcents, at) values ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)",
        [organizationId, callId, active.model.id, owner.agent.id, result.usage.inputTokens ?? 0, result.usage.outputTokens ?? 0, Math.round(result.costMicrocents / MICROCENTS_PER_CENT), result.costMicrocents, clock.now()],
      );
      await q.exec("update calls set cost_cents = $2 where id = $1", [callId, callCents()]);
      if (reached) await recordCeiling(callCents(), reached);
    }
    if (!result.ok) return void (await event("caller_speech_read", { ...common, onTime: false, failure: result.failure, status: result.status }));
    const reading = readSpeechDecision(result.answers, vocabulary);
    const marked = reading.marks.background !== undefined || reading.marks.suggestion !== undefined;
    if (marked) {
      // A fala que já saiu pelo prazo de guarda ou foi apagada não tem mais `text`, e não recebe marca.
      const transcriptId = await recorded;
      await q.exec("update call_events set payload = payload || jsonb_build_object('read', $2::jsonb) where id = $1 and kind = 'transcript_user' and payload ? 'text'", [
        transcriptId,
        JSON.stringify(reading.marks),
      ]);
    }
    await event("caller_speech_read", {
      ...common,
      onTime: true,
      background: reading.background,
      reading: reading.reading && { confidence: reading.reading.confidence, suggested: reading.marks.suggestion !== undefined },
      finished: reading.finished === null ? null : { confidence: reading.finished, observation: true },
      marked,
    });
  }

  /** (Re)agenda o fim pela duração máxima, contada de quando a ligação foi atendida. */
  function scheduleDuration(): void {
    cancelDuration();
    const elapsedMs = answeredAt ? clock.now().getTime() - answeredAt.getTime() : 0;
    cancelDuration = schedule(() => wrapUp(FAREWELL.maxDuration, { status: "completed", endReason: "max_duration" }), Math.max(0, durationLimitSeconds * 1000 - elapsedMs));
  }

  const telephony: ToolContext["telephony"] = {
    canTransfer,
    // A ferramenta só marca o desfecho. Ele acontece depois que o resultado dela foi gravado e
    // entregue ao motor, para a linha do tempo fechar na ordem em que as coisas ocorreram.
    async transfer(toE164) {
      requestedEnd ??= { status: "transferred", endReason: "transferred", transferTo: toE164 };
    },
    async hangup(farewell) {
      requestedEnd ??= { status: "completed", endReason: "end_call" };
      requestedFarewell ??= farewell;
    },
    // Sem `sendDtmf` no transporte (a ligação pelo WhatsApp), a ferramenta recusa em vez de fingir.
    ...(transport.sendDtmf && { sendDtmf: transport.sendDtmf.bind(transport) }),
    // O pedido de quem ligou vem do agente; a gravação para aqui, com o pedido já no arquivo.
    // Ferramenta só roda com a chamada no ar; se ela já encerra, não há gravação a parar.
    async pauseRecording(reason) {
      const result = await pauseRecording({ by: "agent" }, reason);
      return result === "call_ended" ? "not_recording" : result;
    },
  };

  /** O contexto das ferramentas de um trecho: `agentId` é o agente do trecho (o número de transferência, a lista de destinos). */
  const contextFor = (legAgentId: string, legLanguage: string, session: VoiceSession): ToolContext => ({
    organizationId,
    callId,
    agentId: legAgentId,
    language: legLanguage,
    q,
    clock,
    telephony,
    // Fala pela sessão do próprio trecho, e só enquanto ela é a atual: a ferramenta de um trecho já
    // substituído numa passagem não fala na voz do agente seguinte.
    say(text) {
      if (!ending && leg?.voice === session) session.say(text);
    },
    waitForApproval: (approvalId, timeoutMs) =>
      deps.approvals.wait(
        approvalId,
        timeoutMs,
        async () => (await q.one<{ status: "pending" | "approved" | "denied" | "expired" }>("select status from approvals where id = $1", [approvalId]))?.status ?? null,
        callEnded.signal,
      ),
    handoff: (target, input) => handOff(session, target, input),
  });

  async function handleToolCall(owner: Leg, call: { id: string; name: string; args: unknown }): Promise<void> {
    let result: ToolResult;
    const tool = owner.enabled.get(call.name);
    try {
      // `owner !== leg`: a sessão que pediu já foi substituída numa passagem e está fechada.
      if (ending || wrappingUp || owner !== leg) {
        result = { ok: false, message: CLOSING_MESSAGE };
      } else if (!tool) {
        result = { ok: false, message: `A ferramenta ${call.name} não está disponível para este agente. Siga a conversa sem ela.` };
        // A ferramenta instalada com esse nome diz se os argumentos são texto pessoal, mesmo fora da lista do agente.
        await event("tool_called", { name: call.name, args: toolCalledArgs(deps.tools.get(call.name), call.args) });
        await event("tool_result", { name: call.name, ok: false, message: result.message, error: "tool is not enabled for this agent" });
      } else {
        result = await runTool(tool, call.args, owner.context);
      }
    } catch (error) {
      // `runTool` só lança se nem o evento pôde ser gravado. O modelo ainda recebe uma resposta.
      log("error", "tool call could not be recorded", { tool: call.name, error: messageOf(error) });
      result = { ok: false, message: TOOL_CRASH_MESSAGE };
    }
    // Depois de uma passagem, a sessão que pediu já fechou: o resultado não tem a quem ir.
    if (!ending && owner === leg) owner.voice.sendToolResult(call.id, result);
    // Com despedida, a ligação só cai depois de ela ser falada: sem isso o modelo às vezes encerrava
    // calado, e a pessoa ouvia a ligação cair na cara dela. Quem fala é o próprio modelo, ao receber
    // o resultado do end_call (que traz a despedida); pedir a fala de novo aqui a repetia.
    if (requestedEnd && requestedFarewell) wrapUp(null, requestedEnd);
    else if (requestedEnd) void finish(requestedEnd);
  }

  /** Para quem o agente pode passar a ligação: só os que existem, da mesma organização (`handoffTargetsOf`). */
  const targetsOf = async (row: AgentRow): Promise<HandoffTarget[]> => (row.agent_handoff_targets.length === 0 ? [] : (await handoffTargetsOf(q, row.id)).targets);

  /** As ferramentas que o motor recebe para o agente. */
  function enabledToolsFor(names: readonly string[], targets: readonly HandoffTarget[]): Map<string, Tool> {
    const enabled = new Map<string, Tool>();
    for (const name of names) {
      const tool = deps.tools.get(name);
      // Sem transferência no canal (ligação pelo WhatsApp), o motor nem a vê: a descrição manda
      // anunciar a transferência antes de chamar, e quem ligou ouviria "vou transferir" e o recuo.
      if (name === "transfer_to_human" && !canTransfer) continue;
      // Ferramenta sem a peça de que depende (a agenda sem cliente) também some: oferecida, o motor a
      // chamaria em toda ligação de agendamento só para ouvir que ela não está ligada.
      if (tool?.available === false) continue;
      // A passagem não se marca: o que a liga é a lista de destinos, abaixo.
      if (tool?.offeredBySession === true) continue;
      if (tool) enabled.set(name, tool);
      else log("error", "agent enables a tool that is not installed; ignoring it", { tool: name });
    }
    // Sem destino que exista, a ferramenta não aparece, e o motor recebe o mesmo de antes.
    const handoffTool = deps.tools.get(TRANSFER_TO_AGENT);
    if (targets.length > 0 && handoffTool) enabled.set(TRANSFER_TO_AGENT, handoffTool);
    return enabled;
  }

  const sessionConfig = (row: AgentRow, instructions: string, greeting: string | undefined, enabled: Map<string, Tool>): VoiceSessionConfig => ({
    instructions,
    greeting,
    voiceId: row.voice_id ?? undefined,
    language: row.language,
    tools: [...enabled.values()].map(toSpec),
    // Dica de reconhecimento; vazia, o motor envia ao provedor o mesmo de antes.
    vocabulary: row.vocabulary,
    // `normal` envia ao provedor o mesmo de antes; `noisy` ajusta a detecção de fala.
    listeningEnvironment: row.listening_environment,
  });

  type EngineRefusal = "engine_not_configured" | "engine_not_responding" | "engine_refused";
  type Opened = { engine: VoiceEngine; voice: VoiceSession } | { engine?: VoiceEngine; reason: EngineRefusal; problem: string };

  /**
   * Abre a sessão de um motor com a chave da organização, ou diz por que não abriu. Nenhum `connect`
   * segura a ligação por mais de `CONNECT_TIMEOUT_MS`: no atendimento, a ligação é recusada com sinal;
   * numa passagem, o agente atual continua na linha.
   */
  async function connectEngine(engineId: string, config: VoiceSessionConfig): Promise<Opened> {
    const found = deps.engines.get(engineId);
    if (!found) return { reason: "engine_not_configured", problem: `the voice engine "${engineId}" is not installed` };
    let apiKey = "";
    if (!found.keyless) {
      const stored = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, engineKeySetting(engineId)]);
      if (typeof stored?.value !== "string") return { engine: found, reason: "engine_not_configured", problem: "no API key is saved for this voice engine" };
      try {
        apiKey = decryptSecret(stored.value, deps.secretKey);
      } catch (error) {
        return { engine: found, reason: "engine_not_configured", problem: `the saved API key cannot be read (${messageOf(error)})` };
      }
    }
    const endedProblem = "the call ended before the engine connected";
    if (ending) return { engine: found, reason: "engine_not_configured", problem: endedProblem };
    const connecting = found.connect(config, apiKey);
    let cancelDeadline: () => void = () => undefined;
    const deadline = new Promise<never>((_, reject) => {
      cancelDeadline = schedule(() => reject(new EngineTimeoutError(`the provider did not answer in ${CONNECT_TIMEOUT_MS / 1000} s`)), CONNECT_TIMEOUT_MS);
    });
    // A abertura corre também contra o fim da ligação: quem desligou não espera o prazo, e o
    // encerramento (que espera as ferramentas, a passagem inclusive) solta a telefonia na hora.
    let stopWatchingEnd: () => void = () => undefined;
    const callGone = new Promise<never>((_, reject) => {
      const onEnd = (): void => reject(new CallEndedError(endedProblem));
      callEnded.signal.addEventListener("abort", onEnd, { once: true });
      stopWatchingEnd = () => callEnded.signal.removeEventListener("abort", onEnd);
    });
    try {
      return { engine: found, voice: await Promise.race([connecting, deadline, callGone]) };
    } catch (error) {
      if (error instanceof EngineTimeoutError || error instanceof CallEndedError) {
        // Se a sessão ainda abrir depois do prazo ou do fim da ligação, ninguém vai usá-la.
        connecting.then((late) => late.close(), () => undefined);
        if (error instanceof CallEndedError) return { engine: found, reason: "engine_not_configured", problem: endedProblem };
        return { engine: found, reason: "engine_not_responding", problem: `the voice provider did not answer (${messageOf(error)})` };
      }
      // A chave existe: o provedor recusou a sessão (chave recusada, crédito esgotado, limite da conta)
      // ou não foi alcançado pela rede (DNS, firewall de saída). O motivo vem no `problem`.
      return { engine: found, reason: "engine_refused", problem: `the voice provider refused the session or could not be reached (${messageOf(error)})` };
    } finally {
      cancelDeadline();
      stopWatchingEnd();
    }
  }

  /**
   * Põe um agente na linha: liga os eventos da sessão dele e o torna o atual. Nada aqui espera: o
   * motor só começa a emitir no próximo ciclo, e os handlers precisam estar no lugar antes da primeira fala.
   */
  function startLeg(row: AgentRow, legEngine: VoiceEngine, session: VoiceSession, enabled: Map<string, Tool>): Leg {
    const silenceGuard = createSilenceGuard({
      clock,
      schedule,
      closeCallerTurn: () => session.closeCallerTurn(),
      // `wrapUp` e `finish` param a guarda: depois disso ela não chama nada.
      say: (text) => session.say(text),
      acted: (report) => void event("caller_unanswered", report).catch(logFailure("could not record an unanswered caller")),
    });
    const self: Leg = {
      agent: row,
      engine: legEngine,
      voice: session,
      enabled,
      guard: silenceGuard,
      context: contextFor(row.id, row.language, session),
      usage: { seconds: 0, inputTokens: 0, outputTokens: 0, textInputTokens: 0, cachedInputTokens: 0, textOutputTokens: 0 },
      costCents: 0,
    };
    // Uma sessão substituída numa passagem já foi fechada; o que ela ainda emitir não vai para a linha.
    const current = (): boolean => leg === self;
    session.on("callerActivity", (signal) => {
      if (current()) silenceGuard.callerActivity(signal);
    });
    session.on("audio", (pcm) => {
      if (!current()) return;
      silenceGuard.agentAudio(pcm.length / PCM16_8K_BYTES_PER_MS);
      if (ending) return;
      transport.sendAudio(pcm);
      recorder?.agent(pcm);
    });
    session.on("interrupted", () => {
      if (!current()) return;
      silenceGuard.agentInterrupted();
      transport.clearAudio();
      recorder?.clear();
    });
    session.on("transcript", (turn) => {
      // Depois de uma passagem, a fala do agente leva quem falou.
      const payload = turn.speaker === "agent" && handoffs > 0 ? { text: turn.text, agentId: row.id } : { text: turn.text };
      const recorded = recordEventWithId(q, callId, turn.speaker === "user" ? "transcript_user" : "transcript_agent", payload, clock.now());
      recorded.catch(logFailure("could not record a transcript"));
      if (turn.speaker === "agent") return void (lastAgentText = turn.text);
      // Com o filtro desligado, nada além da fala; com ele, a pergunta corre ao lado, sem segurar nada.
      if (!filter || ending || turn.text.trim() === "") return;
      const reading: Promise<void> = readCallerSpeech(self, filter, turn.text, recorded)
        .catch(logFailure("could not record the reading of a caller turn"))
        .finally(() => readingsRunning.delete(reading));
      readingsRunning.add(reading);
    });
    session.on("toolCall", (toolCall) => {
      // Ferramenta em curso, aprovação em espera inclusive: a guarda não age até ela acabar.
      silenceGuard.toolStarted();
      const running: Promise<void> = handleToolCall(self, toolCall).finally(() => {
        toolsRunning.delete(running);
        silenceGuard.toolFinished();
      });
      toolsRunning.add(running);
    });
    // A última medição de uma sessão substituída também conta, e no trecho dela.
    session.on("usage", (increment) => void meter(self, increment).catch(logFailure("could not record usage")));
    // `error` sozinho não é fatal: fica guardado para explicar um `closed` que venha em seguida.
    session.on("error", (error) => {
      self.lastError = error;
      log("error", "voice engine error", { error: error.message, agentId: row.id });
    });
    session.on("closed", (reason) => {
      if (reason === "client" || !current()) return;
      // O roteiro do motor simulado chegou ao fim.
      if (reason === "ended") return void finish({ status: "completed", endReason: "script_finished" });
      // O motor caiu no meio: evento, aviso, sinal para quem está na linha e, havendo para quem, transferência.
      const error = self.lastError?.message ?? `the voice engine closed the session (${reason})`;
      const transferTo = currentTransferTo();
      void finish({
        status: transferTo ? "transferred" : "failed",
        endReason: "engine_failed",
        transferTo: transferTo ?? undefined,
        tone: true,
        events: [["engine_failed", { engine: legEngine.id, error }], ...(transferTo ? [["transfer_started", { to: transferTo, reason: "engine_failed" }] satisfies [CallEventKind, object]] : [])],
        notice: `O motor de voz ${legEngine.label} caiu no meio de uma ligação do agente ${row.name}: ${error}. ${transferTo ? `A ligação foi transferida para ${transferTo}.` : canTransfer ? "A ligação foi encerrada, porque o agente não tem número de transferência." : "A ligação foi encerrada, porque este canal não tem como transferir."} Confira a chave e a situação do provedor em Configurações → Inteligência artificial.`,
      });
    });
    leg = self;
    legs.push(self);
    agent = row;
    voice = session;
    guard = silenceGuard;
    return self;
  }

  /**
   * A passagem da ligação para outro agente (desenho de 13/11, seção 4.2). A sessão do destino abre
   * antes de a atual fechar: se não abrir, o agente atual continua na linha e a ferramenta devolve
   * `ok: false`. Aberta, ela vira a atual, a antiga fecha (a última medição fica no trecho dela) e o
   * áudio passa a ir para a nova. O transporte, a gravação e a linha de `calls` não mudam, e os
   * limites continuam sendo os da ligação: o menor teto e a menor duração entre os agentes por onde
   * ela passou, com o relógio contado do atendimento.
   */
  async function handOff(fromSession: VoiceSession, target: HandoffTarget, input: { reason: string; summary: string }): Promise<HandoffOutcome> {
    const from = leg;
    if (ending || wrappingUp || !from || from.voice !== fromSession) return { ok: false, problem: "closing" };
    if (handingOff) return { ok: false, problem: "busy" };
    if (handoffs >= MAX_AGENT_HANDOFFS_PER_CALL) return { ok: false, problem: "limit" };
    handingOff = true;
    try {
      // Pelo `withOrg` da ligação: um agente de outra organização não é encontrado.
      const next = await q.one<AgentRow>(`select ${AGENT_COLUMNS} from agents where id = $1`, [target.id]);
      if (!next) return { ok: false, problem: "unavailable", detail: "the target agent was not found in this organization" };
      const targets = await targetsOf(next);
      const enabled = enabledToolsFor(next.tools, targets);
      const instructions = composeInstructions(next.instructions, targets, { fromName: from.agent.name, reason: input.reason, summary: input.summary }, memory?.items);
      // A chamada simulada abre o motor simulado na ligação inteira, o trecho do destino inclusive:
      // ela nunca gasta com o provedor nem usa a chave da organização.
      const opened = await connectEngine(overrides?.engineId ?? next.engine, sessionConfig(next, instructions, handoffGreetingFor(next.language), enabled));
      if (!("voice" in opened) && ending) return { ok: false, problem: "closing" };
      if (!("voice" in opened)) {
        log("error", "the next agent's session did not open; the current agent stays on the line", { to: next.id, reason: opened.reason, error: opened.problem });
        return { ok: false, problem: "unavailable", detail: opened.problem };
      }
      if (ending || wrappingUp) {
        await opened.voice.close();
        return { ok: false, problem: "closing" };
      }
      // Daqui até a troca nada espera: a sessão nova só emite no próximo ciclo.
      handoffs += 1;
      // O motor do trecho que começa, e não o do agente: o agente pode ser editado depois, e a
      // chamada simulada abre o simulado no destino. É dele que saem os minutos de cada motor em Custos.
      const recorded = event("agent_handoff", {
        from: { id: from.agent.id, name: from.agent.name },
        to: { id: next.id, name: next.name },
        engine: opened.engine.id,
        reason: input.reason,
        summary: input.summary,
      });
      startLeg(next, opened.engine, opened.voice, enabled);
      from.guard.stop();
      visited.push(next);
      if (next.max_call_seconds < durationLimitSeconds) {
        durationLimitSeconds = next.max_call_seconds;
        scheduleDuration();
      }
      // Fechar a sessão antiga entrega a última medição dela, que entra no trecho dela.
      await from.voice.close();
      await recorded;
      // O teto do novo agente pode ser menor que o custo já gasto: vale na hora, sem esperar outra medição.
      const reached = reachCeiling(callCents());
      if (reached) await recordCeiling(callCents(), reached);
      return { ok: true };
    } finally {
      handingOff = false;
    }
  }

  /** Lê `calls.decision_model` e abre o filtro. Devolve o motivo quando ele foi ligado e não abriu. */
  async function openFilter(): Promise<{ failure: "model_not_installed" | "key_missing" | "key_unreadable"; model: string } | undefined> {
    const stored = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, DECISION_MODEL_SETTING]);
    const chosen = decisionModelOf(stored?.value);
    if (chosen === undefined) return undefined;
    const modelId = overrides?.engineId ? "simulated" : chosen;
    const model = deps.decisionModels?.get(modelId);
    if (!model) return { failure: "model_not_installed", model: modelId };
    if (model.keyless) return void (filter = { model, apiKey: "" });
    const key = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, decisionModelKeySetting(model.id)]);
    if (typeof key?.value !== "string") return { failure: "key_missing", model: model.id };
    try {
      filter = { model, apiKey: decryptSecret(key.value, deps.secretKey) };
    } catch {
      // O motivo da falha de decifrar não vai para a linha do tempo: só o código.
      return { failure: "key_unreadable", model: model.id };
    }
    return undefined;
  }

  async function run(): Promise<void> {
    const first = (await q.one<AgentRow>(`select ${AGENT_COLUMNS} from agents where id = $1`, [agentId])) ?? undefined;
    agent = first;
    const call = await q.one<{ direction: "inbound" | "outbound"; from_e164: string | null; to_e164: string | null }>("select direction, from_e164, to_e164 from calls where id = $1", [callId]);
    if (!first || !call) throw new Error(`Agent ${agentId} or call ${callId} not found in organization ${organizationId}`);
    visited.push(first);

    await event("call_started", { direction: call.direction, from: call.from_e164, to: call.to_e164, agentId, ...input.started });
    transport.onHangup(() => void finish({ status: "completed", endReason: "caller_hangup", callerGone: true }));

    const engineId = overrides?.engineId ?? first.engine;
    const notice = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, RECORDING_NOTICE_SETTING]);
    // Sem texto do operador, ou com texto em branco, vale o padrão: o aviso nunca falta.
    const recordingNotice = typeof notice?.value === "string" && notice.value.trim() !== "" ? notice.value.trim() : DEFAULT_RECORDING_NOTICE;
    // Gravação desligada de fábrica (registro 0016): só grava a organização que ligou. Lida uma vez,
    // no começo: ligar ou desligar no meio não muda a chamada em curso.
    const recording = deps.recordingsDir ? await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, CALL_RECORDING_SETTING]) : null;
    // O arquivo abre antes do motor: depois que ele conecta, nada pode esperar (ver abaixo).
    if (deps.recordingsDir && callRecordingOf(recording?.value)) await openRecording(deps.recordingsDir);
    resolveRecordingDecided();

    const targets = await targetsOf(first);
    const enabled = enabledToolsFor(overrides?.tools ?? first.tools, targets);
    const baseInstructions = overrides?.instructions ?? first.instructions;
    // A memória do número no agente (registro 0020, item 4): só com a chave da organização ligada, em
    // qualquer direção. Lida uma vez, antes do motor, como a gravação; desligada, nada é lido, e as
    // instruções são as de antes, byte a byte. O roteiro do motor simulado não recebe bloco (ele
    // quebraria o JSON), e por isso nem lê. A memória nunca muda as ferramentas nem os destinos, já escolhidos acima.
    if (!baseInstructions.startsWith(SIMULATED_PREFIX)) {
      const memoryKey = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, CALLER_MEMORY_AGENT_SETTING]);
      if (callerMemoryAgentOf(memoryKey?.value)) memory = await loadCallerMemory(q, { callId, now: clock.now() });
    }

    // O filtro da fala: só com `calls.decision_model` gravado. Ausente, a única diferença é a leitura
    // dessa configuração: nenhum pedido sai, e a linha do tempo é a de antes, byte a byte. A chamada
    // simulada nunca gasta com provedor: com o filtro ligado, ela pergunta ao modelo simulado.
    const filterProblem = await openFilter();

    // Chave ausente ou inválida: a chamada não fica muda. É recusada com evento, aviso e sinal.
    const opened = await connectEngine(
      engineId,
      sessionConfig(
        first,
        composeInstructions(baseInstructions, targets, undefined, memory?.items),
        // O aviso vem antes de tudo, e os motores falam a abertura ao conectar: o aviso entra
        // na frente da saudação. Lição do DeskcommCRM: na ligação recebida quem atende fala
        // primeiro; na que nós fazemos, quem atende diz "alô" e o agente responde a isso, então
        // não há saudação, e o aviso sai por `say` assim que a pessoa atende.
        call.direction === "inbound" ? [recordingNotice, first.greeting?.trim()].filter(Boolean).join(" ") : undefined,
        enabled,
      ),
    );
    if (ending) {
      if ("voice" in opened) await opened.voice.close();
      return;
    }
    if (!("voice" in opened)) {
      const label = opened.engine?.label ?? engineId;
      const { reason, problem } = opened;
      return finish({
        status: "refused",
        endReason: reason,
        tone: true,
        events: [["call_refused", { reason, engine: engineId, detail: problem }]],
        notice:
          reason === "engine_not_responding"
            ? `Uma ligação do agente ${first.name} foi recusada porque o provedor do motor de voz ${label} não respondeu: ${problem}. Quem ligou ouviu o sinal de falha. Confira a situação do provedor e faça uma chamada de teste.`
            : reason === "engine_refused"
              ? `Uma ligação do agente ${first.name} foi recusada porque o provedor do motor de voz ${label} recusou a sessão ou não foi alcançado: ${problem}. Quem ligou ouviu o sinal de falha. Confira o crédito e os limites na conta do provedor, a chave em Configurações → Inteligência artificial e, se o motivo for de rede, se a VPS alcança o provedor pela internet; depois faça uma chamada de teste.`
              : opened.engine
                ? `Uma ligação foi recusada porque o motor de voz ${label} do agente ${first.name} não está pronto: ${problem}. Cadastre ou corrija a chave em Configurações → Inteligência artificial e faça uma chamada de teste.`
                : // Sem motor não há chave a cadastrar: o agente aponta para um motor que esta instalação não tem.
                  `Uma ligação foi recusada porque o motor de voz ${label} do agente ${first.name} não está disponível nesta instalação: ${problem}. Escolha outro motor de voz na tela do agente e faça uma chamada de teste.`,
      });
    }

    // Daqui até o fim do bloco nada espera: o motor só começa a emitir no próximo ciclo, e os
    // handlers e os primeiros eventos precisam estar na fila antes da primeira fala.
    const session = opened.voice;
    startLeg(first, opened.engine, session, enabled);
    // O áudio de quem ligou vai para o agente em que a ligação está agora.
    transport.onAudio((pcm) => {
      recorder?.caller(pcm);
      if (!ending && !wrappingUp) voice?.sendAudio(pcm);
    });
    const answered = [
      q.exec("update calls set status = 'in_progress', answered_at = $2, engine = $3 where id = $1", [callId, clock.now(), engineId]),
      event("call_answered", { engine: engineId }),
      event("recording_notice", { text: recordingNotice }),
      // Os ids e o tamanho, nunca o texto: `call_events` não sai com o prazo da memória.
      ...(memory ? [event("memory_loaded", { noteIds: memory.noteIds, followUpIds: memory.followUpIds, chars: memory.chars })] : []),
      // O filtro foi ligado e não pôde abrir: a linha do tempo diz por quê, e a chamada segue sem ele.
      ...(filterProblem ? [event("caller_speech_read", { onTime: false, failure: filterProblem.failure, model: filterProblem.model })] : []),
    ];
    if (call.direction !== "inbound") session.say(recordingNotice);
    answeredAt = clock.now();
    durationLimitSeconds = first.max_call_seconds;
    scheduleDuration();
    await Promise.all(answered);
  }

  run().catch((error: unknown) => {
    log("error", "call session failed", { error: messageOf(error) });
    return finish({ status: "failed", endReason: "internal_error", tone: true });
  });

  return {
    organizationId,
    callId,
    done,
    stop: (reason) => void finish({ status: "completed", endReason: reason }),
    stopRecording: (userId, reason) => pauseRecording({ by: "human", userId }, reason),
  };
}

/**
 * Pedido do painel para parar a gravação de uma chamada em curso neste processo. A organização
 * vem da sessão do painel e precisa ser a da chamada: um id de outra empresa é chamada que não existe.
 */
export async function stopRecordingOfLiveCall(
  sessions: Iterable<CallSession>,
  input: { organizationId: string; callId: string; userId: string; reason: string | null },
): Promise<{ recording: RecordingStop } | { code: string; message: string }> {
  const session = [...sessions].find((live) => live.callId === input.callId && live.organizationId === input.organizationId);
  const result = session ? await session.stopRecording(input.userId, input.reason) : "call_ended";
  if (result === "call_ended") return { code: "call_not_live", message: "This call is not in progress in the voice process." };
  return { recording: result };
}
