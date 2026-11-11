import { FRAME_BYTES, FRAME_MS, SAMPLE_RATE, realSchedule, type CallTransport, type Schedule } from "./transport";

export interface SimulatedTransport extends CallTransport {
  /** Quanto o agente "falou", em ms de áudio entregue. */
  readonly spokenMs: number;
  /** Destino da transferência, se houve. */
  readonly transferredTo: string | null;
  /** `hangup`, `transfer` ou `close` já foi chamado. */
  readonly ended: boolean;
  /** Quem ligou desliga. */
  callerHangup(): void;
}

/**
 * Chamada sem telefonia: quem "ligou" só manda silêncio, em quadros de 20 ms, e a fala do agente
 * é contada em vez de tocada. Serve à chamada simulada do painel, ao `pnpm demo` e aos testes.
 */
export function createSimulatedTransport(options: { schedule?: Schedule } = {}): SimulatedTransport {
  const schedule = options.schedule ?? realSchedule;
  const silence = Buffer.alloc(FRAME_BYTES);
  let spokenBytes = 0;
  let transferredTo: string | null = null;
  let ended = false;
  let cancelFeed: (() => void) | undefined;
  let hangupHandler: (() => void) | undefined;

  const stop = (): void => {
    ended = true;
    cancelFeed?.();
  };

  return {
    get spokenMs() {
      return (spokenBytes / 2 / SAMPLE_RATE) * 1000;
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
        handler(silence);
        cancelFeed = schedule(feed, FRAME_MS);
      };
      cancelFeed?.();
      cancelFeed = schedule(feed, FRAME_MS);
    },
    sendAudio(pcm) {
      if (!ended) spokenBytes += pcm.length;
    },
    clearAudio() {},
    onHangup(handler) {
      hangupHandler = handler;
    },
    async hangup() {
      stop();
    },
    async transfer(toE164) {
      transferredTo = toE164;
      stop();
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
