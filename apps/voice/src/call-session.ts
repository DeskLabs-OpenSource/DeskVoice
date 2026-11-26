import {
  analystObjectionsOf,
  CALL_RECORDING_SETTING,
  CALLER_MEMORY_AGENT_SETTING,
  callerMemoryAgentOf,
  callBackInstruction,
  callRecordingOf,
  decryptSecret,
  enqueueTask,
  fitCallerMemory,
  loadCallerMemory,
  recordEvent,
  recordEventWithId,
  recordingPath,
  rememberedBlock,
  spokenLanguageOf,
  type CallerMemory,
  type CallEventKind,
  type CallStatus,
  type Clock,
  type Db,
  type OpenTurn,
  type OrgQuery,
  type SpokenLanguage,
} from "@deskvoice/core";
import {
  autoCommitOrgQuery,
  handoffTargetsOf,
  MAX_AGENT_HANDOFFS_PER_CALL,
  runTool,
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
  analystQuestions,
  analystState,
  DECISION_DEADLINE_MS,
  DECISION_MODEL_SETTING,
  EngineTimeoutError,
  MICROCENTS_PER_CENT,
  SIMULATED_PREFIX,
  TranscriberOpenError,
  decisionModelKeySetting,
  decisionModelOf,
  estimateCostCents,
  leaks,
  leakShingles,
  readAnalystDecision,
  readSpeechDecision,
  speechFilterQuestions,
  speechFilterState,
  type AnalystConfig,
  type AnalystTurn,
  type DecideResult,
  type DecisionModel,
  type EnginePricing,
  type KeyCheckResult,
  type StreamingTranscriber,
  type StreamingTranscription,
  type Usage,
  type VoiceEngine,
  type VoiceSession,
  type VoiceSessionConfig,
} from "@deskvoice/voice-engine";
import type { ApprovalWaiter } from "./approvals";
import { messageOf, silentLogger, type Logger } from "./log";
import { panelNotice } from "./panel-notice";
import { CALLER_SILENT, createCallerIdleGuard, type CallerIdleGuard } from "./caller-idle";
import { createSilenceGuard, type SilenceGuard } from "./silence-guard";
import {
  composeInstructions,
  enabledToolsFor,
  engineKeySetting,
  handoffItems,
  inboundOpening,
  oneLine,
  RECORDING_NOTICE_SETTING,
  recordingNoticeOf,
  sessionConfig,
} from "./session-config";
import { createTurnLatencyMeter } from "./turn-latency";
import { MIN_FREE_BYTES_TO_RECORD, freeBytes, startRecording, type Recording } from "./recording";
import { CALLER_HANGUP, noticeUnansweredTransfer } from "./transfer-notice";
import { failureTone, realSchedule, type CallTransport, type Schedule, type TransferOutcome } from "./transport";

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
  /** As peças de transcrição em streaming instaladas (`loadTranscribers`). Sem elas, nenhuma chamada usa peça. */
  transcribers?: Map<string, StreamingTranscriber>;
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
  /**
   * A peça de transcrição em streaming desta chamada (R12, fatia 2). Ausente, a chamada é byte a
   * byte a de sempre. Ainda não há onde o operador escolha (fatia 4): por enquanto, só os testes.
   */
  transcriberId?: string;
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
  /**
   * Só no fim por `caller_hangup`: a vez aberta lida no instante do desligar, antes de `finish`
   * soltar as ferramentas e parar a guarda. Vai para `call_ended.openTurn`; ausente, o campo não é gravado.
   */
  openTurn?: OpenTurn | null;
  /**
   * Só no fim por `caller_hangup` e só se a guarda pediu para repetir nesta ligação: quem ligou deu
   * sinal de fala com palavras depois do último pedido. Vai para `call_ended.callerSpokeAfterAsk`;
   * ausente, o campo não é gravado.
   */
  callerSpokeAfterAsk?: boolean;
  /** A telefonia já saiu daqui (a transferência terminou do lado do Asterisk): `finish` não a toca. */
  released?: boolean;
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
  analyst_id: string | null;
  /** Ninguém atendeu a transferência: a ligação volta para o agente (Vapi · fatia 5a). */
  transfer_returns_to_agent: boolean;
  /** O "ainda está aí?" (Vapi · fatia 9, decisão B): desligada, o trecho nasce sem a guarda, que não pergunta nem encerra. */
  caller_idle_guard: boolean;
}

const AGENT_COLUMNS =
  "id, name, instructions, greeting, engine, voice_id, language, tools, max_call_seconds, cost_ceiling_cents, transfer_to_e164, vocabulary, listening_environment, agent_handoff_targets, analyst_id, transfer_returns_to_agent, caller_idle_guard";

/** Um trecho da ligação: o tempo em que ela esteve com um agente, com o motor e o custo dele. */
interface Leg {
  agent: AgentRow;
  /**
   * As instruções do agente do trecho antes de `composeInstructions` (as do agente, ou as da religação,
   * ou o roteiro do simulado): o trecho de volta parte delas e monta de novo, com um bloco lembrado só.
   */
  baseInstructions: string;
  engine: VoiceEngine;
  voice: VoiceSession;
  enabled: Map<string, Tool>;
  guard: SilenceGuard;
  /** A guarda do "ainda está aí?" (item 9 da segunda leva Vapi). */
  /** Ausente com a chave do agente desligada. */
  idle: CallerIdleGuard | undefined;
  context: ToolContext;
  usage: LegUsage;
  /** O custo do trecho: o do motor, com o preço dele, mais o da peça de transcrição no trecho. */
  costCents: number;
  /** A peça de transcrição do trecho, aberta ou abrindo (R12, "a peça é do trecho"). Ausente, o trecho não tem peça. */
  piece?: LegPiece;
  /** O consumo e o custo da peça neste trecho, com o preço dela. A peça que passa adiante leva só o consumo de depois. */
  transcriber: { usage: LegUsage; costCents: number };
  /** O último `error` do motor, para explicar um `closed` que venha em seguida. */
  lastError?: Error;
  /** O analista do agente do trecho (fatia 3 da R6), aberto antes do motor. Ausente, nada muda. */
  analyst?: LegAnalyst;
  /** As objeções que já orientaram o agente neste trecho: cada uma orienta uma vez só. */
  guided: Set<string>;
  /**
   * As ferramentas em curso neste trecho, pelo id da chamada: o cancelamento do provedor aborta o
   * `signal` delas e marca `cancelled`, e aí o resultado não vai ao motor.
   */
  toolsInFlight: Map<string, { name: string; abort: AbortController; cancelled: boolean }>;
}

type LegUsage = Required<Pick<Usage, "seconds" | "inputTokens" | "outputTokens" | "textInputTokens" | "cachedInputTokens" | "textOutputTokens">>;
const emptyUsage = (): LegUsage => ({ seconds: 0, inputTokens: 0, outputTokens: 0, textInputTokens: 0, cachedInputTokens: 0, textOutputTokens: 0 });

/**
 * A peça de transcrição de um trecho. Ela passa ao trecho seguinte só com a mesma peça e a mesma
 * abertura (mesmo idioma, mesmos primeiros termos); nos outros casos fecha na passagem.
 */
interface LegPiece {
  transcriber: StreamingTranscriber;
  /** O que a peça recebe ao abrir: a regra da passagem compara isto. */
  config: { language: string; vocabulary: readonly string[] };
  /** O trecho dono da peça agora: o consumo dela cai nele. Muda só quando a peça passa adiante. */
  owner: Leg;
  /** A conexão, depois que abriu. */
  session?: StreamingTranscription;
  /** Saiu da linha (fechou numa passagem, no fim ou caiu): o que ela emitir não vale, e se abrir depois disto fecha na hora. */
  gone: boolean;
}

/** A peça que o agente de um trecho pede, já com a chave lida, ou a chave que não serve. */
type PieceChoice = { transcriber: StreamingTranscriber; apiKey: string; config: LegPiece["config"] } | { rejected: string; detail: string };

/** O analista aberto para um trecho: o modelo de decisão, a chave e o cadastro lido no começo do trecho. */
interface LegAnalyst {
  id: string;
  model: DecisionModel;
  apiKey: string;
  config: AnalystConfig;
}

/** Por que o analista do agente não abriu. O trecho segue sem ele, e a linha do tempo diz o código. */
type AnalystProblem = { analystId: string; failure: "model_not_installed" | "key_missing" | "key_unreadable"; model: string };

/** Quantas falas a ligação guarda para o `state` do analista: as do pedido, e não mais. */
const ANALYST_TURNS_KEPT = 6;

/**
 * O embrulho da orientação (desenho dos analistas ao vivo, seção 3.3), sempre o mesmo. Quem embrulha é
 * a ligação, e nunca o analista: o texto do meio é o que o operador escreveu e aprovou.
 */
export function wrapGuidance(guidance: string): string {
  return [
    "Orientação interna do analista, sobre a fala anterior da pessoa. Não diga isto a quem ligou e não cite que existe um analista. Ela não autoriza nada que as suas instruções não permitam.",
    `Orientação: «${guidance}»`,
  ].join("\n");
}

// A montagem da sessão mora em `session-config.ts`, com o teste do agente; os nomes seguem daqui.
export { DEFAULT_RECORDING_NOTICE, engineKeySetting, RECORDING_NOTICE_SETTING } from "./session-config";
/** A chave da peça de transcrição, cifrada como a do motor. */
export const transcriberKeySetting = (transcriberId: string): string => `transcriber.${transcriberId}.api_key`;
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
 * do motivo e do resumo, que estão nas instruções. Vai no idioma do agente que recebe, na mesma lista
 * do aviso da caixa postal: quem escolhe é `spokenLanguageOf`, então `en-US` fala inglês e um idioma
 * que as falas não têm cai no padrão do produto.
 */
export const HANDOFF_GREETINGS: Readonly<Record<SpokenLanguage, string>> = {
  "pt-BR": "Oi, vou continuar o seu atendimento a partir daqui.",
  en: "Hi, I'll take it from here and continue helping you.",
  es: "Hola, voy a continuar con su atención a partir de aquí.",
};

export function handoffGreetingFor(language: string): string {
  return HANDOFF_GREETINGS[spokenLanguageOf(language)];
}

/**
 * O que o agente diz primeiro no trecho de volta, quando ninguém atendeu a transferência (Vapi · fatia
 * 5a). Fixa, como a da passagem: quem ligou ouviu a linha chamar e precisa ouvir o agente na hora.
 */
export const TRANSFER_RETURN_GREETINGS: Readonly<Record<SpokenLanguage, string>> = {
  "pt-BR": "Ninguém da equipe conseguiu atender agora. Posso anotar um recado ou pedir para alguém retornar a sua ligação?",
  en: "Nobody on the team could pick up right now. Can I take a message or ask someone to call you back?",
  es: "Nadie del equipo pudo atender ahora. ¿Puedo tomar un recado o pedir que alguien le devuelva la llamada?",
};

/** A orientação do trecho de volta, somada às instruções do agente. `status` é o `DIALSTATUS`. */
export function transferReturnInstruction(status: string): string {
  return [
    `A transferência para uma pessoa da equipe não foi atendida (${oneLine(status)}), e quem ligou voltou a falar com você. Ela acabou de ouvir você dizer que ninguém conseguiu atender e perguntar se pode anotar um recado ou pedir um retorno.`,
    "Não tente transferir de novo. Ofereça deixar um recado para a equipe ou registrar uma pendência para alguém retornar, com as ferramentas que você tem, e diga à pessoa o que foi feito. O motivo e o resumo da transferência estão no bloco abaixo.",
  ].join("\n");
}

// `HandoffNote`, `handoffItems` e `composeInstructions` moram em `session-config.ts`, com o teste do
// agente; os nomes seguem daqui.
export { composeInstructions, handoffItems, type HandoffNote } from "./session-config";

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
  /** A guarda do "ainda está aí?", do trecho atual. Existe a partir de quando o motor conecta. */
  let idleGuard: CallerIdleGuard | undefined;
  /** O trecho da ligação em curso: um por agente por onde ela passou. */
  let leg: Leg | undefined;
  /** Todos os trechos, o atual inclusive: o custo da ligação é a soma dos custos deles. */
  const legs: Leg[] = [];
  /** Os agentes por onde a ligação passou: os limites da ligação são os menores entre eles. */
  const visited: AgentRow[] = [];
  let handoffs = 0;
  let handingOff = false;
  /**
   * A transferência com volta (Vapi · fatia 5a) está tocando: o motor fechou, as ferramentas foram
   * soltas e as guardas pararam, mas a ligação ainda não terminou. O fim pedido fica em `pendingTransfer`.
   */
  let transferring = false;
  let pendingTransfer: Ending | undefined;
  /** A ligação já voltou de uma transferência não atendida: não transfere de novo, por nenhum caminho. */
  let returned: { status: string; transferTo: string } | undefined;
  /** Solta as ferramentas em espera ao começar a transferência. Um novo a cada trecho de volta. */
  let toolsRelease = new AbortController();
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
  /** O custo do filtro e do analista, em micro-centavos: um pedido custa milésimos de centavo. */
  let decisionMicrocents = 0;
  /** As últimas falas da ligação, de quem ligou e do agente, de qualquer trecho: o `state` do analista. */
  const recentTurns: AnalystTurn[] = [];
  /** Quantas falas de quem ligou a ligação já teve: a resposta de um pedido feito antes da última vira `stale`. */
  let callerTurnCount = 0;
  /** No máximo um pedido do analista em voo por ligação; fala nova com ele em voo pede de novo ao terminar. */
  let analystBusy = false;
  let analystAgain = false;
  /** As orientações entregues, com as sequências de 6 palavras de cada uma, para vigiar o vazamento. */
  const deliveredGuidance: Array<{ analystId: string; objection: string; shingles: string[] }> = [];
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
  /** A latência por turno (item 6 da segunda leva Vapi): cada turno fica aqui, e vira um `turn_latency` só no fim. */
  const latency = createTurnLatencyMeter(clock);
  /**
   * O "pode repetir?" desta ligação (desenho do follow-up da ligação que caiu, seção 3.1): `undefined`
   * sem pedido; depois dele, se quem ligou deu `callerActivity{words: true}` desde o último pedido.
   * É um fato da sessão, e não a ausência de transcrição: a última fala antes do desligar costuma
   * não virar `transcript_user`.
   */
  let callerSpokeAfterAsk: boolean | undefined;
  const callEnded = new AbortController();
  let resolveDone: (outcome: CallOutcome) => void = () => undefined;
  const done = new Promise<CallOutcome>((resolve) => (resolveDone = resolve));

  /**
   * A vez aberta agora (desenho do follow-up da ligação que caiu, seção 3.1). Lida no instante em que
   * quem ligou desligou, antes de `finish`: depois dele as ferramentas foram soltas, a guarda parou e a
   * fila de áudio foi descartada, e tudo pareceria fechado. Com a despedida já em curso (`end_call`,
   * duração máxima ou teto de custo), a ligação já tinha o fim decidido aqui, e a vez conta como
   * fechada: quem desliga ouvindo o "tchau" não deixou a conversa no meio.
   */
  function openTurnNow(): OpenTurn | null {
    if (ending || wrappingUp) return null;
    const heard = guard?.openTurn() ?? null;
    if (heard) return heard;
    return toolsRunning.size > 0 ? "tool_running" : null;
  }

  /** O único encerramento: por qualquer caminho, roda uma vez. */
  async function finish(requested: Ending): Promise<void> {
    if (ending) return;
    // Durante a transferência, a ligação é da discagem: o fim é o da transferência, e a telefonia não
    // é tocada (quem ligou pode estar falando com a pessoa que atendeu). `callEnded` avisa o
    // transporte, que desliga como antes se ninguém atender.
    const end: Ending = transferring && pendingTransfer && !requested.released ? { ...pendingTransfer, released: true } : requested;
    ending = true;
    guard?.stop();
    // A ligação que encerra (a transferência para a equipe inclusive) não pergunta mais "ainda está
    // aí?". Um estado de espera da transferência que não encerre a sessão para esta guarda ao entrar nele.
    idleGuard?.stop();
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
      // A peça do trecho também entrega o último consumo ao fechar; sem peça, nada muda aqui.
      if (leg?.piece) await closePiece(leg);
      for (const [kind, payload] of end.events ?? []) await event(kind, payload);
      if (end.notice) await panelNotice(q, clock, callId, end.notice);
      // O trecho de volta terminou sem ninguém ficar com o próximo passo: o aviso "retorne a ligação"
      // que a transferência não atendida mandaria sai agora, uma vez só.
      if (returned && !(await followedUpSinceReturn())) await noticeUnansweredTransfer(q, { callId, transferTo: returned.transferTo }, returned.status, clock, true);
      await q.exec("update calls set status = $2, end_reason = $3, ended_at = $4, cost_cents = $5 where id = $1", [callId, end.status, end.endReason, clock.now(), callCents()]);
      // Um evento por ligação, antes do fim; sem turno medido, nenhum.
      const turnLatency = latency.summary();
      if (turnLatency) await event("turn_latency", turnLatency);
      await event("call_ended", {
        status: end.status,
        reason: end.endReason,
        costCents: callCents(),
        seconds: Math.round(usage.seconds),
        ...(end.openTurn !== undefined && { openTurn: end.openTurn }),
        ...(end.callerSpokeAfterAsk !== undefined && { callerSpokeAfterAsk: end.callerSpokeAfterAsk }),
      });
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
    if (!end.released) {
      try {
        if (end.tone && !end.callerGone) transport.sendAudio(failureTone());
        if (end.callerGone) await transport.close();
        else if (end.status === "transferred" && end.transferTo) await transport.transfer(end.transferTo);
        else await transport.hangup();
      } catch (error) {
        log("error", "could not release the telephony side", { error: messageOf(error) });
      }
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
    idleGuard?.stop();
    // Sem texto: o modelo já vai falar a despedida (o resultado da ferramenta pediu), e só se espera.
    if (farewell) {
      latency.notAnswer();
      voice?.say(farewell);
    }
    cancelTimers.push(schedule(() => void finish(end), FAREWELL_MS));
  }

  /** Teto de custo da ligação: o menor `cost_ceiling_cents` acima de zero entre os agentes por onde ela passou. Zero é "sem teto". */
  function costCeiling(): number {
    const positive = visited.map((row) => row.cost_ceiling_cents).filter((cents) => cents > 0);
    return positive.length === 0 ? 0 : Math.min(...positive);
  }

  /**
   * O número de transferência que vale: o do agente em que a ligação está agora, se o canal transfere.
   * Depois de uma volta, nenhum: nem o teto de custo nem a queda do motor transferem de novo.
   */
  const currentTransferTo = (): string | null => (canTransfer && !returned ? (agent?.transfer_to_e164 ?? null) : null);

  /**
   * Confere o teto contra o custo somado da ligação. Alcançado, a despedida começa na hora, sem
   * esperar o banco, e volta o que registrar na linha do tempo.
   */
  function reachCeiling(total: number): { ceiling: number; transferTo: string | null } | undefined {
    const ceiling = costCeiling();
    // Teto zero é "sem teto": com `>=`, zero derrubaria toda chamada na primeira medição. Durante a
    // transferência não há motor para se despedir: se ela voltar, o trecho de volta confere o teto ao abrir.
    if (!(ceiling > 0 && total >= ceiling) || ending || wrappingUp || transferring) return undefined;
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

  function accumulate(into: LegUsage, increment: Usage): void {
    into.seconds += increment.seconds ?? 0;
    into.inputTokens += increment.inputTokens ?? 0;
    into.outputTokens += increment.outputTokens ?? 0;
    into.textInputTokens += increment.textInputTokens ?? 0;
    into.cachedInputTokens += increment.cachedInputTokens ?? 0;
    into.textOutputTokens += increment.textOutputTokens ?? 0;
  }

  /**
   * Mede um incremento de consumo no trecho. Quem consome é o motor do trecho ou a peça de
   * transcrição dele, cada um com o preço dele: o custo do trecho é motor + peça, e o da ligação, a
   * soma dos trechos, que respeita o teto.
   */
  async function meter(from: Leg, increment: Usage, piece?: { id: string; pricing: EnginePricing }): Promise<void> {
    if (piece) {
      accumulate(from.transcriber.usage, increment);
      from.transcriber.costCents = estimateCostCents(piece.pricing, from.transcriber.usage);
    } else {
      usage.seconds += increment.seconds ?? 0;
      accumulate(from.usage, increment);
    }
    from.costCents = estimateCostCents(from.engine.pricing, from.usage) + from.transcriber.costCents;
    // Cada trecho é calculado com o preço do motor dele, e o custo da ligação é a soma dos trechos:
    // com dois agentes em motores de preço diferente, um preço só erraria a conta.
    // `usage` é incremento: o custo sai do total somado, e cada linha do extrato leva a diferença.
    // Assim a soma do extrato é sempre o custo da chamada, apesar do arredondamento.
    const total = legs.reduce((sum, each) => sum + each.costCents, 0);
    const delta = total - costCents;
    costCents = total;
    const reached = reachCeiling(callCents());
    await q.exec(
      "insert into usage_ledger (organization_id, call_id, engine, agent_id, seconds, input_tokens, output_tokens, cost_cents, cost_microcents, at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        organizationId,
        callId,
        // A peça tem linha própria no extrato, e não se confunde com um motor de mesmo id.
        piece ? `transcriber:${piece.id}` : from.engine.id,
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
    await chargeDecision(owner, active.model, result, null);
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

  /**
   * O custo de um pedido ao modelo de decisão, do filtro (`source` nulo) ou do analista (`analyst`): uma
   * linha por pedido, no agente do trecho, com o id do modelo no lugar do motor. Entra no total da
   * ligação e no teto, que vale para voz, filtro e analista somados. O custo estimado (pedido que saiu
   * sem consumo lido: atrasado, sem rede, fora da forma) entra igual, marcado. Custo desconhecido nunca
   * é zero.
   */
  async function chargeDecision(owner: Leg, model: DecisionModel, result: DecideResult, source: "analyst" | null): Promise<void> {
    if (!(result.costMicrocents > 0 || (result.usage.inputTokens ?? 0) > 0)) return;
    decisionMicrocents += result.costMicrocents;
    const reached = reachCeiling(callCents());
    await q.exec(
      "insert into usage_ledger (organization_id, call_id, engine, agent_id, seconds, input_tokens, output_tokens, cost_cents, cost_microcents, cost_estimated, source, at) values ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10, $11)",
      [
        organizationId,
        callId,
        model.id,
        owner.agent.id,
        result.usage.inputTokens ?? 0,
        result.usage.outputTokens ?? 0,
        Math.round(result.costMicrocents / MICROCENTS_PER_CENT),
        result.costMicrocents,
        result.costEstimated === true,
        source,
        clock.now(),
      ],
    );
    await q.exec("update calls set cost_cents = $2 where id = $1", [callId, callCents()]);
    if (reached) await recordCeiling(callCents(), reached);
  }

  /** Guarda uma fala para o `state` do analista: só as últimas, de qualquer trecho. */
  function rememberTurn(turn: AnalystTurn): void {
    recentTurns.push(turn);
    if (recentTurns.length > ANALYST_TURNS_KEPT) recentTurns.shift();
  }

  /**
   * O analista na ligação (desenho dos analistas ao vivo, seção 3.4). Corre ao lado da conversa:
   * nada no caminho da voz espera por ele. No máximo um pedido em voo por ligação; fala nova com ele
   * em voo marca "pergunte de novo ao terminar", e só a última conta. Toda a cadeia corre presa em
   * `readingsRunning`, para o fim da chamada gravar o que ela disser antes de `call_ended`.
   */
  function askAnalyst(): void {
    if (analystBusy) return void (analystAgain = true);
    const owner = leg;
    if (!owner?.analyst || ending) return;
    analystBusy = true;
    const asking: Promise<void> = readAnalyst(owner, owner.analyst)
      .catch(logFailure("could not record the analyst reading"))
      .finally(() => {
        readingsRunning.delete(asking);
        analystBusy = false;
        if (!analystAgain) return;
        analystAgain = false;
        askAnalyst();
      });
    readingsRunning.add(asking);
  }

  async function readAnalyst(owner: Leg, analyst: LegAnalyst): Promise<void> {
    const askedTurn = callerTurnCount;
    // A fala de quem ligou vai só no `state`. As perguntas são fixas ou escritas pelo operador.
    const input = { state: analystState(recentTurns), questions: analystQuestions(analyst.config) };
    const askedAt = clock.now().getTime();
    let result: DecideResult;
    try {
      result = await analyst.model.decide(analyst.apiKey, input, { timeoutMs: DECISION_DEADLINE_MS, schedule });
    } catch (error) {
      // O contrato diz que `decide` nunca lança. Se lançar, o trecho segue sem orientação, e a linha do tempo diz.
      log("error", "the analyst decision model threw", { error: messageOf(error), model: analyst.model.id });
      return void (await event("analyst_read", analystRead(owner, analyst, { model: analyst.model.id, latencyMs: clock.now().getTime() - askedAt, onTime: false, failure: "exception", status: null })));
    }
    const latencyMs = clock.now().getTime() - askedAt;
    await chargeDecision(owner, analyst.model, result, "analyst");
    if (!result.ok) return void (await event("analyst_read", analystRead(owner, analyst, { model: result.model, latencyMs, onTime: false, failure: result.failure, status: result.status })));
    const reading = readAnalystDecision(result.answers, analyst.config);
    const read = event(
      "analyst_read",
      analystRead(owner, analyst, { model: result.model, latencyMs, onTime: true, temperature: reading.temperature, objection: reading.objection, failure: null, status: null }),
    );
    const objection = reading.guidance;
    // Sem objeção no corte, ou com a mesma que já orientou este trecho: nada mais a fazer.
    if (!objection || owner.guided.has(objection.key)) return void (await read);
    const common = { analystId: analyst.id, agentId: owner.agent.id, objection: objection.key };
    // Outra fala de quem ligou chegou depois do pedido, ou o trecho já é outro: a orientação é velha.
    if (askedTurn !== callerTurnCount || owner !== leg || ending || wrappingUp) {
      await read;
      return void (await event("analyst_guidance", { ...common, outcome: "stale" }));
    }
    if (!owner.voice.guide) {
      await read;
      return void (await event("analyst_guidance", { ...common, outcome: "engine_unsupported" }));
    }
    // Entra pelo `guide`, nunca por `say`: a orientação não vira fala.
    owner.voice.guide(wrapGuidance(objection.guidance));
    owner.guided.add(objection.key);
    deliveredGuidance.push({ analystId: analyst.id, objection: objection.key, shingles: leakShingles(objection.guidance) });
    await read;
    await event("analyst_guidance", { ...common, outcome: "delivered" });
  }

  /** O `analyst_read` sempre com todos os campos, nulos quando não há o que dizer. Nunca leva texto de quem ligou. */
  function analystRead(
    owner: Leg,
    analyst: { id: string },
    fields: { model: string; latencyMs: number | null; onTime: boolean; temperature?: { score: number; confidence: number } | null; objection?: { key: string | null; confidence: number } | null; failure: string | null; status: number | null },
  ): Record<string, unknown> {
    return { analystId: analyst.id, agentId: owner.agent.id, temperature: null, objection: null, ...fields };
  }

  /** A fala do agente repetiu 6 palavras seguidas de uma orientação entregue: mede o fracasso, sem cortar nada. */
  function watchLeak(agentId: string, text: string): void {
    for (const delivered of deliveredGuidance) {
      if (!leaks(text, delivered.shingles)) continue;
      void event("analyst_guidance_leaked", { analystId: delivered.analystId, agentId, objection: delivered.objection }).catch(logFailure("could not record a guidance leak"));
    }
  }

  /**
   * Lê o analista do agente e abre o modelo dele, antes do motor do trecho. Sem analista, nada muda.
   * Modelo não instalado, chave ausente ou ilegível: o trecho segue sem analista, e quem chama grava o
   * motivo. Na chamada simulada o modelo é o simulado, como no filtro: ela nunca gasta com provedor.
   */
  async function openAnalyst(row: AgentRow): Promise<{ analyst?: LegAnalyst; problem?: AnalystProblem }> {
    if (!row.analyst_id) return {};
    // Pelo `withOrg` da ligação: analista de outra organização não é encontrado.
    const stored = await q.one<{ id: string; decision_model: string; temperature: boolean; objections: unknown }>("select id, decision_model, temperature, objections from analysts where id = $1", [row.analyst_id]);
    if (!stored) return {};
    // A ligação valida de novo ao ler: um cadastro fora da regra vale como nenhuma objeção.
    const config: AnalystConfig = { temperature: stored.temperature, objections: analystObjectionsOf(stored.objections) };
    const modelId = overrides?.engineId ? "simulated" : stored.decision_model;
    const model = deps.decisionModels?.get(modelId);
    if (!model) return { problem: { analystId: stored.id, failure: "model_not_installed", model: modelId } };
    if (model.keyless) return { analyst: { id: stored.id, model, apiKey: "", config } };
    const key = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, decisionModelKeySetting(model.id)]);
    if (typeof key?.value !== "string") return { problem: { analystId: stored.id, failure: "key_missing", model: model.id } };
    try {
      return { analyst: { id: stored.id, model, apiKey: decryptSecret(key.value, deps.secretKey), config } };
    } catch {
      // O motivo da falha de decifrar não vai para a linha do tempo: só o código.
      return { problem: { analystId: stored.id, failure: "key_unreadable", model: model.id } };
    }
  }

  /** O analista foi ligado no agente e não abriu: a linha do tempo diz por quê, e o trecho segue sem ele. */
  const analystProblemEvent = (agentId: string, problem: AnalystProblem): Promise<void> =>
    event("analyst_read", { analystId: problem.analystId, agentId, model: problem.model, latencyMs: null, onTime: false, temperature: null, objection: null, failure: problem.failure, status: null });

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
  const contextFor = (legAgentId: string, legLanguage: string, session: VoiceSession, enabled: ReadonlyMap<string, Tool>): ToolContext => ({
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
      if (ending || leg?.voice !== session) return;
      latency.notAnswer();
      session.say(text);
    },
    waitForApproval: (approvalId, timeoutMs) =>
      deps.approvals.wait(
        approvalId,
        timeoutMs,
        async () => (await q.one<{ status: "pending" | "approved" | "denied" | "expired" }>("select status from approvals where id = $1", [approvalId]))?.status ?? null,
        // O fim da ligação e o começo de uma transferência soltam a espera.
        AbortSignal.any([callEnded.signal, toolsRelease.signal]),
      ),
    handoff: (target, input) => handOff(session, target, input),
    // O que o motor deste trecho recebeu: a frase de uma ferramenta só manda usar outra que ele tem.
    offeredTools: new Set(enabled.keys()),
  });

  async function handleToolCall(owner: Leg, call: { id: string; name: string; args: unknown }): Promise<void> {
    let result: ToolResult;
    const tool = owner.enabled.get(call.name);
    const inFlight = { name: call.name, abort: new AbortController(), cancelled: false };
    owner.toolsInFlight.set(call.id, inFlight);
    try {
      // `owner !== leg`: a sessão que pediu já foi substituída numa passagem e está fechada.
      if (ending || wrappingUp || transferring || owner !== leg) {
        result = { ok: false, message: CLOSING_MESSAGE };
      } else if (!tool) {
        result = { ok: false, message: `A ferramenta ${call.name} não está disponível para este agente. Siga a conversa sem ela.` };
        // A ferramenta instalada com esse nome diz se os argumentos são texto pessoal, mesmo fora da lista do agente.
        await event("tool_called", { name: call.name, args: toolCalledArgs(deps.tools.get(call.name), call.args) });
        await event("tool_result", { name: call.name, ok: false, message: result.message, error: "tool is not enabled for this agent" });
      } else {
        result = await runTool(tool, call.args, { ...owner.context, signal: inFlight.abort.signal });
      }
    } catch (error) {
      // `runTool` só lança se nem o evento pôde ser gravado. O modelo ainda recebe uma resposta.
      log("error", "tool call could not be recorded", { tool: call.name, error: messageOf(error) });
      result = { ok: false, message: TOOL_CRASH_MESSAGE };
    } finally {
      owner.toolsInFlight.delete(call.id);
    }
    // Depois de uma passagem, a sessão que pediu já fechou: o resultado não tem a quem ir. Cancelada
    // pelo provedor, o modelo já não espera o resultado; o `tool_result` gravado diz o que saiu.
    if (!ending && !transferring && owner === leg && !inFlight.cancelled) owner.voice.sendToolResult(call.id, result);
    // Com despedida, a ligação só cai depois de ela ser falada: sem isso o modelo às vezes encerrava
    // calado, e a pessoa ouvia a ligação cair na cara dela. Quem fala é o próprio modelo, ao receber
    // o resultado do end_call (que traz a despedida); pedir a fala de novo aqui a repetia.
    if (requestedEnd && requestedFarewell) wrapUp(null, requestedEnd);
    else if (requestedEnd) void endOrTransfer(requestedEnd);
  }

  /**
   * O fim pedido por uma ferramenta. A transferência para uma pessoa, com a volta ligada no agente e
   * num canal que volta (o Asterisk), não encerra a ligação: ela toca primeiro (`transferWithReturn`).
   * Só a pedida pelo agente: a do teto de custo voltaria acima do teto, e a da queda do motor já não
   * tem motor para voltar.
   */
  function endOrTransfer(end: Ending): Promise<void> {
    const returnable =
      end.status === "transferred" &&
      end.endReason === "transferred" &&
      end.transferTo !== undefined &&
      transport.canReturnFromTransfer === true &&
      agent?.transfer_returns_to_agent === true &&
      !returned;
    return returnable ? transferWithReturn(end, end.transferTo as string) : finish(end);
  }

  /**
   * A transferência que pode voltar (Vapi · fatia 5a). Enquanto toca, a ligação fica em
   * `transferring`: o motor fecha (não se paga motor ouvindo a linha chamar), as ferramentas em espera
   * são soltas e as guardas param, sem `call_ended` nem `review_call`. O fim de verdade roda uma vez,
   * em `finish`: no atendimento (a ligação passa a ser da pessoa da equipe e sai do limite de ligações
   * simultâneas, como sem a volta), abandonada por quem ligou, ou no fim do trecho de volta.
   */
  async function transferWithReturn(end: Ending, transferTo: string): Promise<void> {
    if (ending || transferring) return;
    transferring = true;
    pendingTransfer = end;
    guard?.stop();
    // O "ainda está aí?" também para (DESA-356): quem ligou está calado porque espera a linha tocar. O
    // `stop` não volta atrás, então o `toolFinished` do `transfer_to_human` que chega depois não rearma; o
    // trecho de volta nasce com uma guarda nova (`startLeg`), que conta do zero.
    idleGuard?.stop();
    cancelDuration();
    toolsRelease.abort(new Error("The call is being transferred"));
    await Promise.allSettled(toolsRunning);
    await Promise.allSettled(readingsRunning);
    // Fechar o motor entrega a última medição de uso, que fica no trecho dele. A peça é do trecho, como
    // o motor (#198): fecha junto, e o trecho de volta abre a dele.
    await Promise.all([
      voice?.close().catch(logFailure("could not close the voice engine before the transfer")),
      leg ? closePiece(leg).catch(logFailure("could not close the transcriber before the transfer")) : undefined,
    ]);
    if (ending) return;
    let outcome: TransferOutcome | void;
    // O `DIALSTATUS` que o transporte entregou; a falha ao pedir a transferência não chega a discar.
    let dialed = true;
    try {
      outcome = await transport.transfer(transferTo, { returnIfUnanswered: true, signal: callEnded.signal });
    } catch (error) {
      log("error", "the transfer could not start", { error: messageOf(error) });
      outcome = { returned: false, status: "FAILED" };
      dialed = false;
    }
    if (ending) return;
    if (outcome?.returned) {
      await startReturnLeg(outcome.status, transferTo).catch((error: unknown) => {
        log("error", "the call could not go back to the agent", { error: messageOf(error) });
        return finish({ status: "failed", endReason: "internal_error", tone: true, released: false });
      });
      return;
    }
    // Atendida (o fim é o do atendimento: o canal segue com a pessoa da equipe, fora desta conversa),
    // abandonada por quem ligou, ou sem atendimento e sem volta: a telefonia já saiu daqui. Na última,
    // o transporte já gravou o `transfer_unanswered` e mandou o aviso, e o fim não o troca de volta por
    // `transferred` (Vapi · fatia 5a, ajuste 2): a ARI que recusa a volta, o estado que não volta, a
    // discagem que nem começa, o áudio que não reconecta.
    const status = outcome?.status;
    const unanswered = dialed && status !== undefined && status !== "ANSWER" && status !== CALLER_HANGUP;
    await finish({ ...end, released: true, ...(status === CALLER_HANGUP && { callerGone: true }), ...(unanswered && { endReason: "transfer_unanswered" }) });
  }

  /**
   * O trecho de volta: mesma ligação, mesmo agente, motor novo. A primeira fala é fixa, e as
   * instruções dizem que a transferência não foi atendida e mandam oferecer recado ou pendência.
   * `transfer_to_human` sai das ferramentas, e nenhum caminho transfere de novo (`returned`).
   */
  async function startReturnLeg(status: string, transferTo: string): Promise<void> {
    const from = leg;
    const row = agent;
    if (!from || !row) throw new Error("no leg to go back to");
    returned = { status, transferTo };
    // O canal é da conversa de novo: um fim daqui em diante solta a telefonia como sempre. Até o motor
    // novo abrir, nada vai para o antigo, que já fechou.
    transferring = false;
    pendingTransfer = undefined;
    voice = undefined;
    // O fim que a transferência pediu não vale mais: a ligação continua.
    requestedEnd = undefined;
    requestedFarewell = undefined;
    toolsRelease = new AbortController();
    const enabled = new Map([...from.enabled].filter(([name]) => name !== "transfer_to_human"));
    const targets = enabled.has(TRANSFER_TO_AGENT) ? await targetsOf(row) : [];
    // O motivo e o resumo que o agente escreveu para a pessoa vão no bloco lembrado, como na passagem.
    const briefing = await q.one<{ reason: string | null; summary: string | null }>(
      "select payload->>'reason' as reason, payload->>'summary' as summary from call_events where call_id = $1 and kind = 'transfer_started' order by id desc limit 1",
      [callId],
    );
    const lead = handoffItems({ reason: briefing?.reason ?? "", summary: briefing?.summary ?? "" }).filter((item) => item.text.trim() !== "");
    const fitted = memory && fitCallerMemory(memory.notes, memory.followUps, lead);
    // O roteiro do motor simulado passa intacto, como em `composeInstructions`.
    const base = from.baseInstructions.startsWith(SIMULATED_PREFIX) ? from.baseInstructions : `${from.baseInstructions}\n\n${transferReturnInstruction(status)}`;
    const instructions = composeInstructions(base, targets, undefined, fitted?.items ?? lead);
    const greeting = TRANSFER_RETURN_GREETINGS[spokenLanguageOf(row.language)];
    const piece = await choosePiece(row);
    const opened = await connectEngine(overrides?.engineId ?? row.engine, sessionConfig(row, instructions, greeting, enabled));
    if (ending) {
      if ("voice" in opened) await opened.voice.close();
      return;
    }
    if (!("voice" in opened)) {
      return finish({
        status: "failed",
        endReason: "engine_failed",
        tone: true,
        events: [["engine_failed", { engine: opened.engine?.id ?? row.engine, error: opened.problem }]],
      });
    }
    // Daqui até a troca nada espera: a sessão nova só emite no próximo ciclo.
    latency.notAnswer();
    const returnLeg = startLeg(row, opened.engine, opened.voice, enabled, base, from.analyst);
    void seatPiece(returnLeg, from, piece);
    // A duração é da ligação, e não do trecho: o relógio conta do atendimento, com o tempo da discagem.
    scheduleDuration();
    const reached = reachCeiling(callCents());
    if (reached) await recordCeiling(callCents(), reached);
  }

  /** O trecho de volta deixou um recado ou uma pendência: então alguém já ficou com o próximo passo. */
  async function followedUpSinceReturn(): Promise<boolean> {
    const row = await q.one<{ followed: boolean }>(
      `select exists (
         select 1 from call_events
          where call_id = $1 and kind in ('follow_up_created', 'human_notified')
            and id > (select max(id) from call_events where call_id = $1 and kind = 'transfer_returned')
       ) as followed`,
      [callId],
    );
    return row?.followed === true;
  }

  /** Para quem o agente pode passar a ligação: só os que existem, da mesma organização (`handoffTargetsOf`). */
  const targetsOf = async (row: AgentRow): Promise<HandoffTarget[]> => (row.agent_handoff_targets.length === 0 ? [] : (await handoffTargetsOf(q, row.id)).targets);

  /**
   * As ferramentas que o motor recebe para o agente (`session-config.ts`, a mesma escolha do teste do
   * agente). O canal e a volta da transferência são os desta ligação, lidos na hora.
   */
  const toolsFor = (names: readonly string[], targets: readonly HandoffTarget[]): Map<string, Tool> =>
    enabledToolsFor({ installed: deps.tools, names, targets, canTransfer, returned: returned !== undefined, log });

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
  function startLeg(row: AgentRow, legEngine: VoiceEngine, session: VoiceSession, enabled: Map<string, Tool>, baseInstructions: string, analyst?: LegAnalyst): Leg {
    // O turno que a guarda tira sem marco aberto conta com o motor desta perna e o marco que ele emite.
    const guardTurn = { engine: legEngine.id, source: legEngine.callerTurnSource };
    const silenceGuard = createSilenceGuard({
      clock,
      schedule,
      // A resposta forçada pela guarda e o pedido para repetir não entram na latência por turno: o
      // turno vai para `guardTurns`. Com `false`, o motor não mandou nada (o provedor já tinha fechado
      // a vez, só está lento), e o turno segue aberto, como um turno comum.
      closeCallerTurn: () => {
        if (session.closeCallerTurn() !== false) latency.guardActed(guardTurn);
      },
      // `wrapUp` e `finish` param a guarda: depois disso ela não chama nada.
      say: (text) => {
        latency.guardActed(guardTurn);
        session.say(text);
      },
      acted: (report) => {
        // O pedido zera o fato no mesmo instante do `caller_unanswered`: vale só a fala depois do último.
        if (report.action === "asked_to_repeat") callerSpokeAfterAsk = false;
        void event("caller_unanswered", report).catch(logFailure("could not record an unanswered caller"));
      },
    });
    // A chave do agente (decisão B): desligada, não há guarda, e cada `idle?.` abaixo não faz nada.
    const idle = row.caller_idle_guard === false ? undefined : createCallerIdleGuard({
      clock,
      schedule,
      // `wrapUp` e `finish` param a guarda, e a passagem para a do trecho antigo: depois disso ela não chama nada.
      say: (text) => session.say(text),
      end: (farewell) => wrapUp(farewell, { status: "completed", endReason: CALLER_SILENT }),
      acted: (report) => void event("caller_idle", report).catch(logFailure("could not record a silent caller")),
      silenceArmed: () => silenceGuard.armed(),
    });
    const self: Leg = {
      agent: row,
      baseInstructions,
      engine: legEngine,
      voice: session,
      enabled,
      guard: silenceGuard,
      idle,
      context: contextFor(row.id, row.language, session, enabled),
      usage: emptyUsage(),
      costCents: 0,
      transcriber: { usage: emptyUsage(), costCents: 0 },
      ...(analyst && { analyst }),
      guided: new Set(),
      toolsInFlight: new Map(),
    };
    // Uma sessão substituída numa passagem já foi fechada; o que ela ainda emitir não vai para a linha.
    const current = (): boolean => leg === self;
    // Cada sessão conta o que tocou do zero: na passagem de agente, a fala do anterior não é desta.
    const spokenAtStart = transport.playedMs?.() ?? 0;
    session.on("callerActivity", (signal) => {
      if (!current()) return;
      // Antes do filtro da guarda, que ignora fala durante o áudio do agente: quem diz "tchau" por cima
      // do "pode repetir?" falou do mesmo jeito. Início de fala sem texto (`words: false`) não conta.
      if (signal.words && callerSpokeAfterAsk === false) callerSpokeAfterAsk = true;
      silenceGuard.callerActivity(signal);
      // Com ou sem palavras, e mesmo por cima da fala do agente: quem ligou está na linha.
      idle?.callerActivity();
    });
    // O marco da latência por turno. Ferramenta em curso agora, de qualquer trecho: o turno mede o webhook.
    session.on("callerTurnEnded", (signal) => {
      if (!current()) return;
      latency.callerTurnEnded(legEngine.id, signal.source, toolsRunning.size > 0);
    });
    session.on("audio", (pcm) => {
      if (!current()) return;
      silenceGuard.agentAudio(pcm.length / PCM16_8K_BYTES_PER_MS);
      idle?.agentAudio(pcm.length / PCM16_8K_BYTES_PER_MS);
      if (ending) return;
      transport.sendAudio(pcm);
      // A latência conta até o áudio entregue ao transporte, e não até o que o motor mandou.
      latency.agentAudioDelivered();
      recorder?.agent(pcm);
    });
    session.on("interrupted", () => {
      if (!current()) return;
      silenceGuard.agentInterrupted();
      idle?.agentInterrupted();
      latency.interrupted();
      // Antes de descartar: o motor corta no histórico o que quem ligou não chegou a ouvir.
      const spoken = transport.playedMs?.();
      if (spoken !== undefined) session.played?.(spoken - spokenAtStart);
      transport.clearAudio();
      recorder?.clear();
    });
    session.on("transcript", (turn) => {
      // Depois de uma passagem, a fala do agente leva quem falou.
      const payload = turn.speaker === "agent" && handoffs > 0 ? { text: turn.text, agentId: row.id } : { text: turn.text };
      const recorded = recordEventWithId(q, callId, turn.speaker === "user" ? "transcript_user" : "transcript_agent", payload, clock.now());
      recorded.catch(logFailure("could not record a transcript"));
      if (turn.text.trim() !== "") rememberTurn({ speaker: turn.speaker === "user" ? "user" : "agent", text: turn.text });
      if (turn.speaker === "agent") {
        lastAgentText = turn.text;
        if (deliveredGuidance.length > 0) watchLeak(row.id, turn.text);
        return;
      }
      if (turn.text.trim() !== "") callerTurnCount += 1;
      // O analista do trecho, só da sessão atual: a pergunta corre ao lado, sem segurar nada.
      if (self.analyst && current() && !ending && turn.text.trim() !== "") askAnalyst();
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
      idle?.toolStarted();
      if (current()) latency.toolStarted();
      const running: Promise<void> = handleToolCall(self, toolCall).finally(() => {
        toolsRunning.delete(running);
        silenceGuard.toolFinished();
        idle?.toolFinished();
      });
      toolsRunning.add(running);
    });
    // O provedor desistiu de chamadas em curso: o resultado delas é descartado, e a ferramenta que lê o
    // `signal` pode parar. O que ela já fez fica feito, e o `tool_result` dela é gravado como sempre.
    session.on("toolCallCancelled", (ids) => {
      for (const id of ids) {
        const inFlight = self.toolsInFlight.get(id);
        if (!inFlight || inFlight.cancelled) continue;
        inFlight.cancelled = true;
        inFlight.abort.abort();
        if (current()) event("tool_cancelled", { name: inFlight.name }).catch(logFailure("could not record a tool cancellation"));
      }
    });
    // A última medição de uma sessão substituída também conta, e no trecho dela.
    session.on("usage", (increment) => void meter(self, increment).catch(logFailure("could not record usage")));
    // O motor trocou a conexão com o provedor sem fechar a sessão: só fica registrado.
    session.on("resumed", () => {
      if (!current()) return;
      event("engine_resumed", { engine: legEngine.id }).catch(logFailure("could not record the engine resumption"));
    });
    // `error` sozinho não é fatal: fica guardado para explicar um `closed` que venha em seguida.
    session.on("error", (error) => {
      self.lastError = error;
      log("error", "voice engine error", { error: error.message, agentId: row.id });
    });
    session.on("closed", (reason) => {
      // Durante a transferência o motor já foi fechado de propósito: o que ele ainda disser não encerra a ligação.
      if (reason === "client" || !current() || transferring) return;
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
    idleGuard = idle;
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
      const enabled = toolsFor(next.tools, targets);
      // O teto de 1 500 vale para o bloco inteiro, com o motivo e o resumo: o corte é refeito a partir
      // da memória lida no começo da ligação, e nunca em cima do corte de uma passagem anterior.
      const handoff = { fromName: from.agent.name, reason: input.reason, summary: input.summary };
      const lead = handoffItems(handoff);
      const fitted = memory && fitCallerMemory(memory.notes, memory.followUps, lead);
      const instructions = composeInstructions(next.instructions, targets, handoff, fitted?.items ?? []);
      // O trecho novo usa o analista do agente novo, ou nenhum: o do trecho anterior não passa adiante.
      const nextAnalyst = await openAnalyst(next);
      // A peça do agente novo, com a chave lida antes da troca: depois dela, nada espera.
      const nextPiece = await choosePiece(next);
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
      // O que o modelo do destino recebeu da memória: os ids e o tamanho do bloco inteiro, nunca o
      // texto, mesmo quando nada coube.
      const loaded = memory
        ? event("memory_loaded", {
            noteIds: fitted?.noteIds ?? [],
            followUpIds: fitted?.followUpIds ?? [],
            chars: fitted?.chars ?? rememberedBlock(lead).length,
          })
        : undefined;
      const nextLeg = startLeg(next, opened.engine, opened.voice, enabled, next.instructions, nextAnalyst.analyst);
      // A peça passa ao trecho novo se for a mesma, com a mesma abertura; senão, a antiga sai da linha
      // e a nova começa a abrir sem que a passagem espere por ela.
      const leaving = seatPiece(nextLeg, from, nextPiece);
      const analystProblem = nextAnalyst.problem ? analystProblemEvent(next.id, nextAnalyst.problem) : undefined;
      from.guard.stop();
      from.idle?.stop();
      visited.push(next);
      if (next.max_call_seconds < durationLimitSeconds) {
        durationLimitSeconds = next.max_call_seconds;
        scheduleDuration();
      }
      // Fechar a sessão antiga entrega a última medição dela, que entra no trecho dela.
      await from.voice.close();
      // A peça que saiu entrega a última medição ao fechar, e ela fica no trecho dela.
      await leaving;
      await recorded;
      await loaded;
      await analystProblem;
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

  /** Por que a peça de transcrição ficou fora da chamada: o vocabulário do teste da chave, ou `closed`. */
  type TranscriberFailure = Exclude<KeyCheckResult, "accepted" | "not_needed"> | "closed";

  /** A peça de um trecho ficou de fora; a ligação segue. Depois de uma passagem, o evento leva o agente do trecho, como `transcript_agent`. */
  function transcriberFailed(owner: Leg, transcriberId: string, reason: TranscriberFailure, detail: string): void {
    // O texto do provedor fica no log, para quem opera; a linha do tempo leva só o código.
    log("error", "the transcriber is out of this call; the call goes on without it", { transcriber: transcriberId, reason, error: detail, agentId: owner.agent.id });
    const payload = handoffs > 0 ? { transcriber: transcriberId, reason, agentId: owner.agent.id } : { transcriber: transcriberId, reason };
    if (!ending) void event("transcriber_failed", payload).catch(logFailure("could not record a transcriber failure"));
  }

  /**
   * A peça que o agente de um trecho pede. Por enquanto só a chamada simulada pede, e
   * `CallSessionInput.transcriberId` vale para todos os trechos, como o motor simulado; a coluna do
   * agente (fatia 4) entra aqui. Sem pedido, nada é lido do banco.
   */
  async function choosePiece(row: AgentRow): Promise<PieceChoice | undefined> {
    const transcriberId = input.transcriberId;
    if (transcriberId === undefined) return undefined;
    const transcriber = deps.transcribers?.get(transcriberId);
    if (!transcriber) {
      log("error", "the call asks for a transcriber that is not installed; going on without it", { transcriber: transcriberId, agentId: row.id });
      return undefined;
    }
    const config = { language: row.language, vocabulary: row.vocabulary.slice(0, transcriber.maxVocabulary) };
    if (transcriber.keyless) return { transcriber, apiKey: "", config };
    const stored = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, transcriberKeySetting(transcriber.id)]);
    try {
      if (typeof stored?.value !== "string") throw new Error("no API key is saved for this transcriber");
      return { transcriber, apiKey: decryptSecret(stored.value, deps.secretKey), config };
    } catch (error) {
      // Sem chave que sirva, a peça não abre: para quem lê a linha do tempo, é a chave recusada.
      return { rejected: transcriber.id, detail: messageOf(error) };
    }
  }

  const sameOpening = (piece: LegPiece, choice: { transcriber: StreamingTranscriber; config: LegPiece["config"] }): boolean =>
    piece.transcriber.id === choice.transcriber.id &&
    piece.config.language === choice.config.language &&
    piece.config.vocabulary.length === choice.config.vocabulary.length &&
    piece.config.vocabulary.every((term, index) => term === choice.config.vocabulary[index]);

  /** Tira a peça do trecho e a fecha (ou a marca para fechar na hora em que abrir). */
  function closePiece(owner: Leg): Promise<void> {
    const piece = owner.piece;
    owner.piece = undefined;
    if (!piece) return Promise.resolve();
    piece.gone = true;
    return piece.session?.close() ?? Promise.resolve();
  }

  /**
   * Põe a peça no trecho que começa (desenho do #198, "a peça é do trecho"). Mesma peça e mesma
   * abertura: a conexão do trecho anterior passa a este, sem fechar nem reabrir, e o consumo daí em
   * diante cai aqui. Senão, a do trecho anterior sai da linha, e a deste começa a abrir sem que
   * ninguém espere. Devolve o fechamento da que saiu.
   */
  function seatPiece(next: Leg, from: Leg | undefined, choice: PieceChoice | undefined): Promise<void> {
    const old = from?.piece;
    if (from && old && choice && "transcriber" in choice && !old.gone && sameOpening(old, choice)) {
      from.piece = undefined;
      old.owner = next;
      next.piece = old;
      return Promise.resolve();
    }
    const leaving = from ? closePiece(from) : Promise.resolve();
    if (choice && "rejected" in choice) transcriberFailed(next, choice.rejected, "rejected", choice.detail);
    else if (choice) {
      const piece: LegPiece = { transcriber: choice.transcriber, config: choice.config, owner: next, gone: false };
      next.piece = piece;
      void openTranscription(piece, choice.apiKey).catch(logFailure("could not open the transcriber"));
    }
    return leaving;
  }

  /**
   * Abre a peça de transcrição de um trecho ao lado do motor, sem que o motor espere por ela: o áudio
   * de quem ligou continua indo ao motor do mesmo jeito, e só passa a ir também à peça quando ela
   * abre. Se ela não abre, ou cai no meio, a ligação segue sem ela, e a linha do tempo grava o motivo.
   */
  async function openTranscription(piece: LegPiece, apiKey: string): Promise<void> {
    const { transcriber } = piece;
    const connecting = transcriber.connect(piece.config, apiKey);
    let cancelDeadline: () => void = () => undefined;
    const deadline = new Promise<never>((_, reject) => {
      cancelDeadline = schedule(() => reject(new EngineTimeoutError(`the transcriber did not answer in ${CONNECT_TIMEOUT_MS / 1000} s`)), CONNECT_TIMEOUT_MS);
    });
    let opened: StreamingTranscription;
    try {
      opened = await Promise.race([connecting, deadline]);
    } catch (error) {
      if (error instanceof EngineTimeoutError) connecting.then((late) => late.close(), () => undefined);
      const reason = error instanceof TranscriberOpenError ? error.result : error instanceof EngineTimeoutError ? "unreachable" : "unexpected_response";
      if (piece.owner.piece === piece) piece.owner.piece = undefined;
      // A peça que já saiu da linha não diz nada na linha do tempo: o trecho dela acabou.
      if (piece.gone) return void log("error", "a transcriber that already left the line did not open", { transcriber: transcriber.id, error: messageOf(error) });
      piece.gone = true;
      return transcriberFailed(piece.owner, transcriber.id, reason, messageOf(error));
    } finally {
      cancelDeadline();
    }
    // Abriu depois do fim, de uma despedida ou de outra passagem: ninguém vai usá-la.
    if (piece.gone || ending || wrappingUp) return void (await opened.close());
    /** A peça está na linha: é a do trecho atual. Eventos de uma peça que já saiu são ignorados. */
    const current = (): boolean => !piece.gone && leg?.piece === piece;
    let lastText = "";
    opened.on("piece", (said) => {
      if (!current() || !leg) return;
      // Cada trecho com texto novo é sinal de que quem ligou está falando: a guarda contra o
      // silêncio do trecho atual passa a ter texto mesmo no motor que só transcreve depois do turno.
      if (said.text.trim() !== "" && said.text !== lastText) leg.guard.callerActivity({ words: true });
      lastText = said.final ? "" : said.text;
    });
    // A última medição de uma peça que saiu também conta, no trecho dono dela.
    opened.on("usage", (increment) => void meter(piece.owner, increment, transcriber).catch(logFailure("could not record transcriber usage")));
    opened.on("error", (error) => log("error", "transcriber error", { transcriber: transcriber.id, error: error.message }));
    opened.on("closed", (reason) => {
      if (reason === "client" || piece.gone) return;
      piece.gone = true;
      if (piece.owner.piece === piece) piece.owner.piece = undefined;
      transcriberFailed(piece.owner, transcriber.id, "closed", reason);
    });
    piece.session = opened;
  }

  async function run(): Promise<void> {
    const first = (await q.one<AgentRow>(`select ${AGENT_COLUMNS} from agents where id = $1`, [agentId])) ?? undefined;
    agent = first;
    const call = await q.one<{ direction: "inbound" | "outbound"; from_e164: string | null; to_e164: string | null; call_back_of: string | null }>(
      "select direction, from_e164, to_e164, call_back_of from calls where id = $1",
      [callId],
    );
    if (!first || !call) throw new Error(`Agent ${agentId} or call ${callId} not found in organization ${organizationId}`);
    visited.push(first);

    await event("call_started", { direction: call.direction, from: call.from_e164, to: call.to_e164, agentId, ...input.started });
    transport.onHangup(() => void finish({ status: "completed", endReason: "caller_hangup", callerGone: true, openTurn: openTurnNow(), callerSpokeAfterAsk }));

    const engineId = overrides?.engineId ?? first.engine;
    const notice = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, RECORDING_NOTICE_SETTING]);
    // Sem texto do operador, ou com texto em branco, vale o padrão: o aviso nunca falta.
    const recordingNotice = recordingNoticeOf(notice?.value);
    // Gravação desligada de fábrica (registro 0016): só grava a organização que ligou. Lida uma vez,
    // no começo: ligar ou desligar no meio não muda a chamada em curso.
    const recording = deps.recordingsDir ? await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, CALL_RECORDING_SETTING]) : null;
    // O arquivo abre antes do motor: depois que ele conecta, nada pode esperar (ver abaixo).
    if (deps.recordingsDir && callRecordingOf(recording?.value)) await openRecording(deps.recordingsDir);
    resolveRecordingDecided();

    const targets = await targetsOf(first);
    const enabled = toolsFor(overrides?.tools ?? first.tools, targets);
    // A religação da ligação que caiu (desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.6): uma
    // linha fixa, na língua do agente, somada às instruções. Nada da conversa anterior entra por aqui.
    const ownInstructions = overrides?.instructions ?? first.instructions;
    const baseInstructions =
      call.call_back_of !== null && !ownInstructions.startsWith(SIMULATED_PREFIX) ? `${ownInstructions}\n\n${callBackInstruction(first.language)}` : ownInstructions;
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
    // O analista do agente (fatia 3 da R6): só com `agents.analyst_id`. Sem ele, nada é lido além da
    // coluna do agente, nenhum pedido sai, e a linha do tempo é a de antes.
    const firstAnalyst = await openAnalyst(first);
    // A peça de transcrição do primeiro trecho, quando a chamada pede uma. Sem pedido, nada aqui consulta o banco.
    const firstPiece = await choosePiece(first);

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
        call.direction === "inbound" ? inboundOpening(recordingNotice, first.greeting) : undefined,
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
    const firstLeg = startLeg(first, opened.engine, session, enabled, baseInstructions, firstAnalyst.analyst);
    // O áudio de quem ligou vai para o agente em que a ligação está agora.
    transport.onAudio((pcm) => {
      recorder?.caller(pcm);
      // Durante a transferência o motor está fechado: nada vai para ele, nem para a peça.
      if (ending || wrappingUp || transferring) return;
      // O motor recebe primeiro, sem esperar a peça; a peça recebe o mesmo pedaço logo depois.
      voice?.sendAudio(pcm);
      // A peça do trecho atual, e só depois que abriu.
      leg?.piece?.session?.sendAudio(pcm);
    });
    void seatPiece(firstLeg, undefined, firstPiece);
    const answered = [
      // A URA já atendeu e gravou `answered_at` (`ivr-session.ts`): a duração conta desde ali, com o menu,
      // e não do começo da conversa. Sem URA, `answered_at` está vazio e fica com a hora de agora.
      q.exec("update calls set status = 'in_progress', answered_at = coalesce(answered_at, $2), engine = $3 where id = $1", [callId, clock.now(), engineId]),
      event("call_answered", { engine: engineId }),
      event("recording_notice", { text: recordingNotice }),
      // Os ids e o tamanho, nunca o texto: `call_events` não sai com o prazo da memória.
      ...(memory ? [event("memory_loaded", { noteIds: memory.noteIds, followUpIds: memory.followUpIds, chars: memory.chars })] : []),
      // O filtro foi ligado e não pôde abrir: a linha do tempo diz por quê, e a chamada segue sem ele.
      ...(filterProblem ? [event("caller_speech_read", { onTime: false, failure: filterProblem.failure, model: filterProblem.model })] : []),
      // O analista foi ligado e não pôde abrir: idem, e o trecho segue sem ele.
      ...(firstAnalyst.problem ? [analystProblemEvent(first.id, firstAnalyst.problem)] : []),
    ];
    if (call.direction !== "inbound") {
      latency.notAnswer();
      session.say(recordingNotice);
    }
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
