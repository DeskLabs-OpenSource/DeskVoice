import { FRAME_BYTES, FRAME_MS, SAMPLE_RATE, realSchedule, type CallTransport, type Schedule } from "./transport";

export interface SimulatedTransport extends CallTransport {
  /** Quanto o agente "falou", em ms de áudio entregue. */
  readonly spokenMs: number;
  /** Destino da transferência, se houve. */
  readonly transferredTo: string | null;
  /** Teclas que o agente apertou no menu do outro lado. */
  readonly sentDtmf: string[];
  /** `hangup`, `transfer` ou `close` já foi chamado. */
  readonly ended: boolean;
  /** Quem ligou desliga. */
  callerHangup(): void;
}

/**
 * Chamada sem telefonia: quem "ligou" só manda silêncio, em quadros de 20 ms, e a fala do agente
 * é contada em vez de tocada, na cadência real: enquanto ela "toca", quem ligou não manda nada.
 * Serve à chamada simulada do painel, ao `pnpm demo` e aos testes.
 */
export function createSimulatedTransport(options: { schedule?: Schedule } = {}): SimulatedTransport {
  const schedule = options.schedule ?? realSchedule;
  const silence = Buffer.alloc(FRAME_BYTES);
  let spokenBytes = 0;
  /** Fala entregue que ainda não teria tocado: cai 20 ms a cada quadro de quem ligou. */
  let pendingMs = 0;
  let transferredTo: string | null = null;
  const sentDtmf: string[] = [];
  let ended = false;
  let cancelFeed: (() => void) | undefined;
  let hangupHandler: (() => void) | undefined;

  const stop = (): void => {
    ended = true;
    cancelFeed?.();
  };
  /** O contrato de `hangup` e `transfer`: a fala pendente termina de tocar antes de soltar. */
  const drained = (): Promise<void> =>
    pendingMs > 0 && !ended ? new Promise((resolve) => void schedule(resolve, pendingMs)) : Promise.resolve();

  return {
    get spokenMs() {
      return (spokenBytes / 2 / SAMPLE_RATE) * 1000;
    },
    get sentDtmf() {
      return sentDtmf;
    },
    get transferredTo() {
      return transferredTo;
    },
    get ended() {
      return ended;
    },
    onAudio(handler) {
      const feed = (): void => {
        if (ended) return;
        // Quem ligou escuta enquanto a fala do agente toca, e só depois "responde" (issue #111).
        // Sem isso, o roteiro simulado contava a espera de quem ligou com o agente ainda falando, a
        // fala do roteiro inteiro se acumulava na fila e tocava depois do fim da chamada. O buraco
        // de áudio vira silêncio na gravação, que é alinhada pelo relógio.
        if (pendingMs > 0) pendingMs = Math.max(0, pendingMs - FRAME_MS);
        else handler(silence);
        cancelFeed = schedule(feed, FRAME_MS);
      };
      cancelFeed?.();
      cancelFeed = schedule(feed, FRAME_MS);
    },
    sendAudio(pcm) {
      if (ended) return;
      spokenBytes += pcm.length;
      pendingMs += (pcm.length / 2 / SAMPLE_RATE) * 1000;
    },
    clearAudio() {
      pendingMs = 0;
    },
    onHangup(handler) {
      hangupHandler = handler;
    },
    async hangup() {
      await drained();
      stop();
    },
    async transfer(toE164) {
      await drained();
      transferredTo = toE164;
      stop();
    },
    async sendDtmf(digits) {
      if (ended) return;
      sentDtmf.push(digits);
    },
    async close() {
      stop();
    },
    callerHangup() {
      if (ended) return;
      stop();
      hangupHandler?.();
    },
  };
}
