import type { SpokenLanguage } from "@deskvoice/core";
import { messageOf, type Logger } from "./log";
import { readRecordedSpeech } from "./recorded-speech";
import type { CallTransport } from "./transport";

/**
 * A fala de indisponível da organização suspensa (seção 3.3 do desenho do R8,
 * `docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md`).
 *
 * Quem liga para um número de organização suspensa é atendido, ouve "Este número está
 * temporariamente indisponível. Por favor, tente mais tarde." no idioma do agente do número, e a
 * ligação desliga. Nenhum motor de voz é aberto: a fala é áudio já gravado
 * (`scripts/fala-de-indisponivel/gerar.sh`), e a organização suspensa não gasta. A fala não diz o
 * motivo, porque o motivo é da agência com o cliente, e não de quem liga.
 *
 * A chamada já nasce `refused`, com `end_reason = organization_suspended`, antes de a fala tocar:
 * tocar não muda nada no banco, e quem liga desligar no meio também não.
 */
const NOTICE_DIR = new URL("../assets/unavailable-notice/", import.meta.url);

/** O que a chamada recusada carrega até o áudio conectar: só o idioma da fala. */
export interface UnavailableJob {
  language: SpokenLanguage;
}

/** A fala gravada, no formato em que a linha toca. */
export function unavailableNotice(language: SpokenLanguage): Promise<Buffer> {
  return readRecordedSpeech(NOTICE_DIR, "unavailable notice", language);
}

/**
 * Toca a fala e desliga. Nunca rejeita: se a fala não puder ser lida, a ligação desliga do mesmo
 * jeito, e a chamada continua recusada como já estava.
 */
export async function playUnavailable(transport: CallTransport, job: UnavailableJob & { callId: string }, log: Logger): Promise<void> {
  try {
    transport.sendAudio(await unavailableNotice(job.language));
  } catch (error) {
    log("error", "could not play the unavailable notice; hanging up", { callId: job.callId, language: job.language, error: messageOf(error) });
  }
  try {
    await transport.hangup();
  } catch (error) {
    log("error", "could not hang up after the unavailable notice", { callId: job.callId, error: messageOf(error) });
    await transport.close().catch(() => undefined);
  }
}
