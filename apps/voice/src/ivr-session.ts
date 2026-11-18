import { readFile } from "node:fs/promises";
import { enqueueTask, parseRecordedSpeech, personExitOf, recordEvent, withOrg, type CallEventKind, type CallStatus, type Clock, type Db, type IvrMenu, type IvrOption, type SpokenLanguage } from "@deskvoice/core";
import { messageOf, silentLogger, type Logger } from "./log";
import { panelNotice } from "./panel-notice";
import { failureTone, realSchedule, type CallTransport, type KeypadTransport, type Schedule } from "./transport";

/**
 * O menu por teclas (URA), fatia 1 (#223, sobre o #225): irmã de `voicemail.ts`. Uma máquina de
 * estados sobre o transporte, com o tempo pelo `Schedule` injetável, que atende a ligação de um
 * número em `mode = 'ivr'`:
 *
 * - **anúncio**: o áudio que o operador subiu toca. Uma tecla no meio corta o anúncio e vale como
 *   escolha;
 * - **espera**: `timeoutMs` depois de o anúncio terminar de sair (`drained`);
 * - **tecla de uma opção**: `ivr_option_chosen`, e a ação da opção (agente, pessoa ou desligar);
 * - **tecla que não é opção, ou o tempo acabou**: `ivr_no_choice`, sem a tecla, e o anúncio repete
 *   até `maxAttempts`;
 * - **sem escolha depois disso**: `onNoChoice` (a primeira pessoa, ou a fala "sem escolha" e desliga).
 *
 * **Privacidade.** Quem liga pode digitar CPF, cartão ou senha no teclado. Nenhuma tecla entra em
 * evento, log ou transcrição, a não ser a tecla de uma opção que existe, em `ivr_option_chosen`.
 *
 * **Toda falha tem uma fala e um evento.** As falas vêm gravadas (`assets/ivr-notice/<idioma>/`,
 * `scripts/fala-da-ura/gerar.sh`), porque a URA não depende de chave de IA. Se a fala não se lê, quem
 * está na linha ouve os três bipes de `failureTone`.
 *
 * **O erro inesperado também vai à pessoa.** Toda entrada assíncrona da sessão (o começo, a espera, a
 * tecla, a passagem à IA, o desligar e o `stop`) passa por `guard`, que leva qualquer rejeição a
 * `failUnexpected`: a fala `failed`, a pessoa do menu (ou desligar, se ela sumiu) e
 * `ivr_failed { unexpected }`. Nenhuma ligação fica muda por uma promessa sem `catch`.
 *
 * **A passagem à IA.** A opção `agent` grava o agente na chamada e abre a conversa no mesmo
 * transporte (`startAgent`). Antes, a URA neutraliza os próprios handlers: a tecla vira no-op e o
 * desligar que ela registrou passa a ignorar, porque no Asterisk o `onHangup` acumula ouvintes. Daí
 * em diante a chamada é da conversa (`call-session.ts`), que a encerra.
 *
 * O canal sem teclado (a ligação pelo WhatsApp) não declara `onDtmf`, e `KeypadTransport` o exige:
 * ninguém liga a URA a ele sem o compilador reclamar.
 */

/** O que a chamada carrega até o AudioSocket conectar: o menu já lido, com as opções e o áudio. */
export interface IvrJob {
  menu: IvrMenu;
}

/** A URA precisa da tecla e de saber quando o anúncio terminou de sair. */
export type IvrTransport = KeypadTransport & { drained(): Promise<void> };

export type IvrNoticeKind = "no-choice" | "failed";

const NOTICE_DIR = new URL("../assets/ivr-notice/", import.meta.url);

/** A fala gravada de falha, no formato em que a linha toca. */
export async function ivrNotice(language: SpokenLanguage, kind: IvrNoticeKind): Promise<Buffer> {
  return parseRecordedSpeech(await readFile(new URL(`${language}/${kind}.wav`, NOTICE_DIR)), `ivr notice ${language}/${kind}`);
}

export interface IvrDeps {
  db: Db;
  clock: Clock;
  schedule?: Schedule;
  /** Relógio monotônico em ms, para o tempo até a escolha. */
  now?: () => number;
  log?: Logger;
  /** Abre a conversa com o agente no mesmo transporte (`startCallSession`). */
  startAgent(agentId: string, transport: CallTransport): void;
  /** Só para teste: troca a leitura das falas gravadas. */
  notice?: (language: SpokenLanguage, kind: IvrNoticeKind) => Promise<Buffer>;
}

export interface IvrInput extends IvrJob {
  organizationId: string;
  callId: string;
  transport: IvrTransport;
}

/** `agent`: a conversa assumiu. Nos outros, a URA encerrou a chamada. */
export type IvrResult = "agent" | "transfer" | "hangup" | "no_choice" | "failed" | "caller_hangup" | "stopped";

export interface IvrOutcome {
  result: IvrResult;
  /** O desfecho gravado na chamada; nulo quando a conversa assumiu e é ela quem grava. */
  endReason: string | null;
}

export interface IvrSession {
  /** Resolve quando a URA terminou: encerrou a chamada ou a passou à conversa. Nunca rejeita. */
  done: Promise<IvrOutcome>;
  /** Encerra de fora (o processo está saindo). Depois da passagem à conversa, não faz nada. */
  stop(reason: string): void;
}

type IvrFailure = "prompt_unreadable" | "no_person_exit" | "agent_disabled" | "unexpected";

interface Ending {
  result: IvrResult;
  status: CallStatus;
  endReason: string;
  /** Quem ligou já desligou: não há a quem tocar nada. */
  callerGone?: boolean;
  transferTo?: string;
  /** A fala gravada que toca antes de transferir ou desligar. */
  speech?: IvrNoticeKind;
  /** Os eventos que antecedem `call_ended`, na ordem. */
  events: Array<[CallEventKind, object]>;
  notice?: string;
}

const chosenPayload = (option: IvrOption, elapsedMs: number) => ({ digit: option.digit, label: option.label, action: option.action, elapsed_ms: elapsedMs });

export function startIvrSession(deps: IvrDeps, input: IvrInput): IvrSession {
  const { db, clock } = deps;
  const schedule = deps.schedule ?? realSchedule;
  const now = deps.now ?? (() => performance.now());
  const { organizationId, callId, transport, menu } = input;
  // Nenhum campo de log leva tecla: só a chamada, o menu e o desfecho.
  const log: Logger = (level, message, fields) => (deps.log ?? silentLogger)(level, message, { callId, menuId: menu.id, ...fields });
  const startedAt = now();

  /** A URA já decidiu (encerrou ou passou à conversa): nada mais dela acontece. */
  let settled = false;
  let phase: "starting" | "prompt" | "waiting" | "deciding" = "starting";
  let attempt = 0;
  let cancelWait: (() => void) | undefined;
  let resolveDone: (outcome: IvrOutcome) => void = () => undefined;
  const done = new Promise<IvrOutcome>((resolve) => (resolveDone = resolve));

  const elapsed = (): number => Math.round(now() - startedAt);

  const speechOf = async (kind: IvrNoticeKind): Promise<Buffer> => {
    try {
      return await (deps.notice ?? ivrNotice)(menu.language, kind);
    } catch (error) {
      log("error", "could not read the recorded ivr notice; playing the failure tone", { kind, language: menu.language, error: messageOf(error) });
      return failureTone();
    }
  };

  /** A chegada da chamada no banco: atendida pela URA (`in_progress`), com a hora e o evento. */
  const begun = (async (): Promise<void> => {
    try {
      await withOrg(db, organizationId, async (q) => {
        await q.exec("update calls set status = 'in_progress', answered_at = $2 where id = $1 and status = 'ringing'", [callId, clock.now()]);
        await recordEvent(q, callId, "ivr_started", { menu_id: menu.id }, clock.now());
      });
    } catch (error) {
      log("error", "could not record the start of the ivr", { error: messageOf(error) });
    }
  })();

  const recordOne = async (kind: CallEventKind, payload: object): Promise<void> => {
    try {
      await withOrg(db, organizationId, (q) => recordEvent(q, callId, kind, payload, clock.now()));
    } catch (error) {
      log("error", "could not record an ivr event", { kind, error: messageOf(error) });
    }
  };

  /**
   * O único encerramento pela URA: roda uma vez, por qualquer caminho. Grava o desfecho, avisa no
   * painel quando é falha, põe o resumo e a revisão na fila como toda chamada que termina, e solta a
   * telefonia mesmo que o banco falhe.
   */
  async function end(ending: Ending): Promise<void> {
    if (settled) return;
    settled = true;
    phase = "deciding";
    cancelWait?.();
    await begun;
    try {
      await withOrg(db, organizationId, async (q) => {
        for (const [kind, payload] of ending.events) await recordEvent(q, callId, kind, payload, clock.now());
        if (ending.notice) await panelNotice(q, clock, callId, ending.notice);
        if (ending.transferTo) await recordEvent(q, callId, "transfer_started", { to: ending.transferTo, reason: "ivr" }, clock.now());
        await q.exec("update calls set status = $2, end_reason = $3, ended_at = $4 where id = $1", [callId, ending.status, ending.endReason, clock.now()]);
        await recordEvent(q, callId, "call_ended", { status: ending.status, reason: ending.endReason, costCents: 0, seconds: Math.round(elapsed() / 1000) }, clock.now());
        const taskId = await enqueueTask(q, { kind: "summarize_call", payload: {}, callId, runAt: clock.now() });
        await recordEvent(q, callId, "task_queued", { taskId, kind: "summarize_call" }, clock.now());
        const reviewId = await enqueueTask(q, { kind: "review_call", payload: {}, callId, runAt: clock.now() });
        await recordEvent(q, callId, "task_queued", { taskId: reviewId, kind: "review_call" }, clock.now());
      });
    } catch (error) {
      log("error", "could not record the end of the ivr", { error: messageOf(error) });
    }
    // Ninguém fica pendurado: a telefonia é solta mesmo se o banco falhou acima.
    try {
      if (ending.callerGone) await transport.close();
      else {
        if (ending.speech) transport.sendAudio(await speechOf(ending.speech));
        if (ending.transferTo) await transport.transfer(ending.transferTo);
        else await transport.hangup();
      }
    } catch (error) {
      log("error", "could not release the telephony side of the ivr", { error: messageOf(error) });
    }
    log("info", "ivr ended", { result: ending.result, endReason: ending.endReason });
    resolveDone({ result: ending.result, endReason: ending.endReason });
  }

  /** Vai à pessoa depois de uma falha: a fala "não foi possível" e a transferência. */
  const failToPerson = (failure: IvrFailure, events: Array<[CallEventKind, object]>, notice?: string): Promise<void> => {
    const person = personExitOf(menu.options);
    const failed: [CallEventKind, object] = ["ivr_failed", { reason: failure }];
    if (!person?.transferE164) return end({ result: "failed", status: "failed", endReason: "ivr_failed", speech: "failed", events: [...events, failed], notice });
    return end({ result: "failed", status: "transferred", endReason: "ivr_failed", speech: "failed", transferTo: person.transferE164, events: [...events, failed], notice });
  };

  /**
   * A porta única do erro inesperado: `log error` (só a mensagem do erro, nunca uma tecla) e a pessoa.
   * Depois que a URA decidiu, não faz nada além do log (o `end()` já protege).
   */
  const failUnexpected = (error: unknown): Promise<void> => {
    log("error", "ivr session failed", { error: messageOf(error) });
    return failToPerson("unexpected", []);
  };

  /** Toda promessa da sessão que ninguém espera passa por aqui, em vez de `void`. */
  const guard = (work: Promise<void>): void => {
    work.catch(failUnexpected).catch((error: unknown) => log("error", "could not end the ivr after an unexpected failure", { error: messageOf(error) }));
  };

  /** A opção `agent`: o agente precisa estar ligado na hora; a conversa assume no mesmo transporte. */
  async function handOff(option: IvrOption, chosen: object): Promise<void> {
    await begun;
    let enabled = false;
    try {
      await withOrg(db, organizationId, async (q) => {
        const agent = option.agentId ? await q.one<{ enabled: boolean }>("select enabled from agents where organization_id = $1 and id = $2", [organizationId, option.agentId]) : null;
        enabled = agent?.enabled === true;
        if (!enabled) return;
        await recordEvent(q, callId, "ivr_option_chosen", chosen, clock.now());
        await q.exec("update calls set agent_id = $3 where organization_id = $1 and id = $2", [organizationId, callId, option.agentId]);
      });
    } catch (error) {
      log("error", "could not hand the call to the agent", { error: messageOf(error) });
      enabled = false;
    }
    // Quem ligou desligou enquanto o banco gravava: a URA já encerrou.
    if (settled) return;
    if (!enabled || !option.agentId) return failToPerson("agent_disabled", [["ivr_option_chosen", chosen]]);
    cancelWait?.();
    // Daqui em diante a tecla é da conversa. `phase = "deciding"` já segurava a tecla até aqui.
    transport.onDtmf(() => undefined);
    // `settled` só depois de a conversa abrir: se ela lança, a URA ainda encerra e vai à pessoa.
    deps.startAgent(option.agentId, transport);
    settled = true;
    log("info", "ivr handed the call to the agent", { agentId: option.agentId });
    resolveDone({ result: "agent", endReason: null });
  }

  function choose(option: IvrOption): void {
    phase = "deciding";
    const chosen = chosenPayload(option, elapsed());
    if (option.action === "agent") return guard(handOff(option, chosen));
    if (option.action === "transfer" && option.transferE164) {
      return guard(end({ result: "transfer", status: "transferred", endReason: "transferred", transferTo: option.transferE164, events: [["ivr_option_chosen", chosen]] }));
    }
    guard(end({ result: "hangup", status: "completed", endReason: "ivr_hangup", events: [["ivr_option_chosen", chosen], ["ivr_ended", { reason: "option_hangup" }]] }));
  }

  async function noChoice(kind: "timeout" | "invalid"): Promise<void> {
    phase = "deciding";
    cancelWait?.();
    // Sem a tecla: só a tentativa e o tipo.
    await recordOne("ivr_no_choice", { attempt, kind });
    if (settled) return;
    if (attempt < menu.maxAttempts) return playAttempt();
    const person = personExitOf(menu.options);
    if (menu.onNoChoice === "person" && person?.transferE164) {
      return end({ result: "no_choice", status: "transferred", endReason: "transferred", transferTo: person.transferE164, events: [["ivr_ended", { reason: "no_choice", then: "person" }]] });
    }
    return end({ result: "no_choice", status: "completed", endReason: "ivr_no_choice", speech: "no-choice", events: [["ivr_ended", { reason: "no_choice", then: "hangup" }]] });
  }

  async function playAttempt(): Promise<void> {
    if (settled) return;
    attempt += 1;
    const mine = attempt;
    phase = "prompt";
    transport.sendAudio(input.menu.promptAudio ?? Buffer.alloc(0));
    await transport.drained();
    // Uma tecla cortou o anúncio, ou a URA já decidiu: esta espera não vale mais.
    if (settled || attempt !== mine || phase !== "prompt") return;
    phase = "waiting";
    cancelWait = schedule(() => {
      if (!settled && attempt === mine && phase === "waiting") guard(noChoice("timeout"));
    }, menu.timeoutMs);
  }

  function press(digit: string): void {
    if (settled || (phase !== "prompt" && phase !== "waiting")) return;
    // A tecla no meio do anúncio corta o que falta tocar.
    if (phase === "prompt") transport.clearAudio();
    cancelWait?.();
    const option = menu.options.find((candidate) => candidate.digit === digit);
    if (option) choose(option);
    else guard(noChoice("invalid"));
  }

  async function run(): Promise<void> {
    await begun;
    if (settled) return;
    if (!personExitOf(menu.options)) {
      return end({
        result: "failed",
        status: "failed",
        endReason: "ivr_failed",
        speech: "failed",
        events: [["ivr_failed", { reason: "no_person_exit" }]],
        notice: `O menu por teclas "${menu.name}" atendeu uma ligação, mas não tem nenhuma opção que leve a uma pessoa, e a ligação foi encerrada. Acrescente uma opção "pessoa" ao menu em Linha telefônica.`,
      });
    }
    const prompt = menu.promptAudio;
    if (!prompt || prompt.length < 2 || prompt.length % 2 !== 0) {
      const person = personExitOf(menu.options);
      return failToPerson(
        "prompt_unreadable",
        [],
        `O menu por teclas "${menu.name}" atendeu uma ligação, mas o anúncio não pôde ser tocado, e a ligação foi passada para ${person?.transferE164 ?? "a pessoa do menu"}. Suba o anúncio de novo em Linha telefônica.`,
      );
    }
    log("info", "ivr started", { options: menu.options.length });
    await playAttempt();
  }

  // O áudio de quem ouve o menu não vai a lugar nenhum: sem um handler, o transporte o guardaria e o
  // entregaria à conversa, se ela assumir. A conversa troca este handler pelo dela.
  transport.onAudio(() => undefined);
  transport.onDtmf(press);
  transport.onHangup(() => {
    if (settled) return;
    guard(end({ result: "caller_hangup", status: "completed", endReason: "caller_hangup", callerGone: true, events: [["ivr_ended", { reason: "caller_hangup" }]] }));
  });

  guard(run());

  return {
    done,
    stop: (reason) => guard(end({ result: "stopped", status: "completed", endReason: reason, events: [["ivr_ended", { reason: "stopped" }]] })),
  };
}
