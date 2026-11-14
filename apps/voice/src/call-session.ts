import { CALL_RECORDING_SETTING, callRecordingOf, decryptSecret, enqueueTask, recordEvent, recordingPath, type CallEventKind, type CallStatus, type Clock, type Db, type OrgQuery } from "@deskvoice/core";
import { autoCommitOrgQuery, runTool, toSpec, toolCalledArgs, type RecordingStop, type Tool, type ToolContext, type ToolResult } from "@deskvoice/tools";
import { EngineTimeoutError, MICROCENTS_PER_CENT, estimateCostCents, type Usage, type VoiceEngine, type VoiceSession } from "@deskvoice/voice-engine";
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
}

export const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;
export const RECORDING_NOTICE_SETTING = "recording_notice.text";
/** O aviso que vale quando o operador não escreveu o dele. Toda chamada começa por um aviso. */
export const DEFAULT_RECORDING_NOTICE = "Esta ligação é atendida por uma assistente virtual e a conversa fica registrada.";
// Além do prazo do próprio motor: nenhum `connect` segura quem ligou em silêncio por mais que isto.
const CONNECT_TIMEOUT_MS = 15_000;

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

  let agent: AgentRow | undefined;
  let engine: VoiceEngine | undefined;
  let voice: VoiceSession | undefined;
  /** A guarda contra o silêncio (antipadrão 15). Existe a partir de quando o motor conecta. */
  let guard: SilenceGuard | undefined;
  let lastEngineError: Error | undefined;
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
  const usage = { seconds: 0, inputTokens: 0, outputTokens: 0, textInputTokens: 0, cachedInputTokens: 0, textOutputTokens: 0 };
  const cancelTimers: Array<() => void> = [];
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
    // Ferramenta em espera (uma aprovação pendente) é solta, e o resultado dela entra na linha do
    // tempo antes de `call_ended`.
    callEnded.abort(new Error("The call ended before the tool finished"));
    await Promise.allSettled(toolsRunning);
    try {
      // Fechar o motor entrega a última medição de uso; ela entra no custo gravado abaixo.
      await voice?.close();
      for (const [kind, payload] of end.events ?? []) await event(kind, payload);
      if (end.notice) await panelNotice(q, clock, callId, end.notice);
      await q.exec("update calls set status = $2, end_reason = $3, ended_at = $4, cost_cents = $5 where id = $1", [callId, end.status, end.endReason, clock.now(), costCents]);
      await event("call_ended", { status: end.status, reason: end.endReason, costCents, seconds: Math.round(usage.seconds) });
      const taskId = await enqueueTask(q, { kind: "summarize_call", payload: {}, callId, runAt: clock.now() });
      await event("task_queued", { taskId, kind: "summarize_call" });
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
    await recorder?.finish().catch(logFailure("could not save the call recording"));
    await recordingFailed;
    resolveDone({ status: end.status, endReason: end.endReason, costCents });
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

  async function meter(increment: Usage): Promise<void> {
    if (!engine) return;
    usage.seconds += increment.seconds ?? 0;
    usage.inputTokens += increment.inputTokens ?? 0;
    usage.outputTokens += increment.outputTokens ?? 0;
    usage.textInputTokens += increment.textInputTokens ?? 0;
    usage.cachedInputTokens += increment.cachedInputTokens ?? 0;
    usage.textOutputTokens += increment.textOutputTokens ?? 0;
    // `usage` é incremento: o custo sai do total somado, e cada linha do extrato leva a diferença.
    // Assim a soma do extrato é sempre o custo da chamada, apesar do arredondamento.
    const total = estimateCostCents(engine.pricing, usage);
    const delta = total - costCents;
    costCents = total;
    const ceiling = agent?.cost_ceiling_cents ?? 0;
    // Teto zero é "sem teto": com `>=`, zero derrubaria toda chamada na primeira medição.
    const reached = ceiling > 0 && total >= ceiling && !ending && !wrappingUp;
    const transferTo = canTransfer ? (agent?.transfer_to_e164 ?? null) : null;
    if (reached) {
      wrapUp(
        transferTo ? FAREWELL.costCeilingTransfer : FAREWELL.costCeiling,
        transferTo ? { status: "transferred", endReason: "cost_ceiling", transferTo } : { status: "completed", endReason: "cost_ceiling" },
      );
    }
    await q.exec(
      "insert into usage_ledger (organization_id, call_id, engine, seconds, input_tokens, output_tokens, cost_cents, cost_microcents, at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        organizationId,
        callId,
        engine.id,
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
    await q.exec("update calls set cost_cents = $2 where id = $1", [callId, total]);
    if (reached) {
      await event("cost_ceiling_reached", { costCents: total, ceilingCents: ceiling });
      if (transferTo) await event("transfer_started", { to: transferTo, reason: "cost_ceiling" });
    }
  }

  const context: ToolContext = {
    organizationId,
    callId,
    agentId,
    q,
    clock,
    telephony: {
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
    },
    say(text) {
      if (!ending) voice?.say(text);
    },
    waitForApproval: (approvalId, timeoutMs) =>
      deps.approvals.wait(
        approvalId,
        timeoutMs,
        async () => (await q.one<{ status: "pending" | "approved" | "denied" | "expired" }>("select status from approvals where id = $1", [approvalId]))?.status ?? null,
        callEnded.signal,
      ),
  };

  async function handleToolCall(enabled: Map<string, Tool>, call: { id: string; name: string; args: unknown }): Promise<void> {
    let result: ToolResult;
    const tool = enabled.get(call.name);
    try {
      if (ending || wrappingUp) {
        result = { ok: false, message: CLOSING_MESSAGE };
      } else if (!tool) {
        result = { ok: false, message: `A ferramenta ${call.name} não está disponível para este agente. Siga a conversa sem ela.` };
        // A ferramenta instalada com esse nome diz se os argumentos são texto pessoal, mesmo fora da lista do agente.
        await event("tool_called", { name: call.name, args: toolCalledArgs(deps.tools.get(call.name), call.args) });
        await event("tool_result", { name: call.name, ok: false, message: result.message, error: "tool is not enabled for this agent" });
      } else {
        result = await runTool(tool, call.args, context);
      }
    } catch (error) {
      // `runTool` só lança se nem o evento pôde ser gravado. O modelo ainda recebe uma resposta.
      log("error", "tool call could not be recorded", { tool: call.name, error: messageOf(error) });
      result = { ok: false, message: TOOL_CRASH_MESSAGE };
    }
    if (!ending) voice?.sendToolResult(call.id, result);
    // Com despedida, a ligação só cai depois de ela ser falada: sem isso o modelo às vezes encerrava
    // calado, e a pessoa ouvia a ligação cair na cara dela. Quem fala é o próprio modelo, ao receber
    // o resultado do end_call (que traz a despedida); pedir a fala de novo aqui a repetia.
    if (requestedEnd && requestedFarewell) wrapUp(null, requestedEnd);
    else if (requestedEnd) void finish(requestedEnd);
  }

  async function run(): Promise<void> {
    agent = (await q.one<AgentRow>(
      "select name, instructions, greeting, engine, voice_id, language, tools, max_call_seconds, cost_ceiling_cents, transfer_to_e164, vocabulary, listening_environment from agents where id = $1",
      [agentId],
    )) ?? undefined;
    const call = await q.one<{ direction: "inbound" | "outbound"; from_e164: string | null; to_e164: string | null }>("select direction, from_e164, to_e164 from calls where id = $1", [callId]);
    if (!agent || !call) throw new Error(`Agent ${agentId} or call ${callId} not found in organization ${organizationId}`);
    const transferTo = canTransfer ? agent.transfer_to_e164 : null;

    await event("call_started", { direction: call.direction, from: call.from_e164, to: call.to_e164, agentId, ...input.started });
    transport.onHangup(() => void finish({ status: "completed", endReason: "caller_hangup", callerGone: true }));

    const engineId = overrides?.engineId ?? agent.engine;
    engine = deps.engines.get(engineId);
    const notice = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, RECORDING_NOTICE_SETTING]);
    // Sem texto do operador, ou com texto em branco, vale o padrão: o aviso nunca falta.
    const recordingNotice = typeof notice?.value === "string" && notice.value.trim() !== "" ? notice.value.trim() : DEFAULT_RECORDING_NOTICE;
    // Gravação desligada de fábrica (registro 0016): só grava a organização que ligou. Lida uma vez,
    // no começo: ligar ou desligar no meio não muda a chamada em curso.
    const recording = deps.recordingsDir ? await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, CALL_RECORDING_SETTING]) : null;
    // O arquivo abre antes do motor: depois que ele conecta, nada pode esperar (ver abaixo).
    if (deps.recordingsDir && callRecordingOf(recording?.value)) await openRecording(deps.recordingsDir);
    resolveRecordingDecided();

    const enabled = new Map<string, Tool>();
    for (const name of overrides?.tools ?? agent.tools) {
      const tool = deps.tools.get(name);
      // Sem transferência no canal (ligação pelo WhatsApp), o motor nem a vê: a descrição manda
      // anunciar a transferência antes de chamar, e quem ligou ouviria "vou transferir" e o recuo.
      if (name === "transfer_to_human" && !canTransfer) continue;
      if (tool) enabled.set(name, tool);
      else log("error", "agent enables a tool that is not installed; ignoring it", { tool: name });
    }

    // Chave ausente ou inválida: a chamada não fica muda. É recusada com evento, aviso e sinal.
    let apiKey = "";
    let problem: string | undefined;
    let reason: "engine_not_configured" | "engine_not_responding" = "engine_not_configured";
    if (!engine) {
      problem = `the voice engine "${engineId}" is not installed`;
    } else if (!engine.keyless) {
      const stored = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, engineKeySetting(engineId)]);
      if (typeof stored?.value !== "string") {
        problem = "no API key is saved for this voice engine";
      } else {
        try {
          apiKey = decryptSecret(stored.value, deps.secretKey);
        } catch (error) {
          problem = `the saved API key cannot be read (${messageOf(error)})`;
        }
      }
    }
    if (engine && problem === undefined && !ending) {
      const connecting = engine.connect(
        {
          instructions: overrides?.instructions ?? agent.instructions,
          // O aviso vem antes de tudo, e os motores falam a abertura ao conectar: o aviso entra
          // na frente da saudação. Lição do DeskcommCRM: na ligação recebida quem atende fala
          // primeiro; na que nós fazemos, quem atende diz "alô" e o agente responde a isso, então
          // não há saudação, e o aviso sai por `say` assim que a pessoa atende.
          greeting: call.direction === "inbound" ? [recordingNotice, agent.greeting?.trim()].filter(Boolean).join(" ") : undefined,
          voiceId: agent.voice_id ?? undefined,
          language: agent.language,
          tools: [...enabled.values()].map(toSpec),
          // Dica de reconhecimento; vazia, o motor envia ao provedor o mesmo de antes.
          vocabulary: agent.vocabulary,
          // `normal` envia ao provedor o mesmo de antes; `noisy` ajusta a detecção de fala.
          listeningEnvironment: agent.listening_environment,
        },
        apiKey,
      );
      let cancelDeadline: () => void = () => undefined;
      const deadline = new Promise<never>((_, reject) => {
        cancelDeadline = schedule(() => reject(new EngineTimeoutError(`the provider did not answer in ${CONNECT_TIMEOUT_MS / 1000} s`)), CONNECT_TIMEOUT_MS);
      });
      try {
        voice = await Promise.race([connecting, deadline]);
      } catch (error) {
        if (error instanceof EngineTimeoutError) {
          reason = "engine_not_responding";
          problem = `the voice provider did not answer (${messageOf(error)})`;
          // Se a sessão ainda abrir depois do prazo, ninguém vai usá-la.
          connecting.then((late) => late.close(), () => undefined);
        } else {
          problem = `the voice engine refused the session (${messageOf(error)})`;
        }
      } finally {
        cancelDeadline();
      }
    }
    if (ending) return void (await voice?.close());
    if (!voice || !engine) {
      const label = engine?.label ?? engineId;
      return finish({
        status: "refused",
        endReason: reason,
        tone: true,
        events: [["call_refused", { reason, engine: engineId, detail: problem }]],
        notice:
          reason === "engine_not_responding"
            ? `Uma ligação do agente ${agent.name} foi recusada porque o provedor do motor de voz ${label} não respondeu: ${problem}. Quem ligou ouviu o sinal de falha. Confira a situação do provedor e faça uma chamada de teste.`
            : `Uma ligação foi recusada porque o motor de voz ${label} do agente ${agent.name} não está pronto: ${problem}. Cadastre ou corrija a chave em Configurações → Inteligência artificial e faça uma chamada de teste.`,
      });
    }

    // Daqui até o fim do bloco nada espera: o motor só começa a emitir no próximo ciclo, e os
    // handlers e os primeiros eventos precisam estar na fila antes da primeira fala.
    const session = voice;
    const engineLabel = engine.label;
    const silenceGuard = createSilenceGuard({
      clock,
      schedule,
      closeCallerTurn: () => session.closeCallerTurn(),
      // `wrapUp` e `finish` param a guarda: depois disso ela não chama nada.
      say: (text) => session.say(text),
      acted: (report) => void event("caller_unanswered", report).catch(logFailure("could not record an unanswered caller")),
    });
    guard = silenceGuard;
    session.on("callerActivity", (signal) => silenceGuard.callerActivity(signal));
    session.on("audio", (pcm) => {
      silenceGuard.agentAudio(pcm.length / PCM16_8K_BYTES_PER_MS);
      if (ending) return;
      transport.sendAudio(pcm);
      recorder?.agent(pcm);
    });
    session.on("interrupted", () => {
      silenceGuard.agentInterrupted();
      transport.clearAudio();
      recorder?.clear();
    });
    session.on("transcript", (turn) => void event(turn.speaker === "user" ? "transcript_user" : "transcript_agent", { text: turn.text }).catch(logFailure("could not record a transcript")));
    session.on("toolCall", (toolCall) => {
      // Ferramenta em curso, aprovação em espera inclusive: a guarda não age até ela acabar.
      silenceGuard.toolStarted();
      const running: Promise<void> = handleToolCall(enabled, toolCall).finally(() => {
        toolsRunning.delete(running);
        silenceGuard.toolFinished();
      });
      toolsRunning.add(running);
    });
    session.on("usage", (increment) => void meter(increment).catch(logFailure("could not record usage")));
    // `error` sozinho não é fatal: fica guardado para explicar um `closed` que venha em seguida.
    session.on("error", (error) => {
      lastEngineError = error;
      log("error", "voice engine error", { error: error.message });
    });
    session.on("closed", (reason) => {
      if (reason === "client") return;
      // O roteiro do motor simulado chegou ao fim.
      if (reason === "ended") return void finish({ status: "completed", endReason: "script_finished" });
      // O motor caiu no meio: evento, aviso, sinal para quem está na linha e, havendo para quem, transferência.
      const error = lastEngineError?.message ?? `the voice engine closed the session (${reason})`;
      void finish({
        status: transferTo ? "transferred" : "failed",
        endReason: "engine_failed",
        transferTo: transferTo ?? undefined,
        tone: true,
        events: [["engine_failed", { engine: engineId, error }], ...(transferTo ? [["transfer_started", { to: transferTo, reason: "engine_failed" }] satisfies [CallEventKind, object]] : [])],
        notice: `O motor de voz ${engineLabel} caiu no meio de uma ligação do agente ${agent?.name}: ${error}. ${transferTo ? `A ligação foi transferida para ${transferTo}.` : canTransfer ? "A ligação foi encerrada, porque o agente não tem número de transferência." : "A ligação foi encerrada, porque este canal não tem como transferir."} Confira a chave e a situação do provedor em Configurações → Inteligência artificial.`,
      });
    });
    transport.onAudio((pcm) => {
      recorder?.caller(pcm);
      if (!ending && !wrappingUp) session.sendAudio(pcm);
    });
    const answered = [
      q.exec("update calls set status = 'in_progress', answered_at = $2, engine = $3 where id = $1", [callId, clock.now(), engineId]),
      event("call_answered", { engine: engineId }),
      event("recording_notice", { text: recordingNotice }),
    ];
    if (call.direction !== "inbound") session.say(recordingNotice);
    cancelTimers.push(schedule(() => wrapUp(FAREWELL.maxDuration, { status: "completed", endReason: "max_duration" }), agent.max_call_seconds * 1000));
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
