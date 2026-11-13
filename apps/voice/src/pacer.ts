import { FRAME_MS, type Schedule } from "./transport";

// Depois de um engasgo do processo, no máximo este número de pedaços sai de uma vez.
const MAX_BURST_FRAMES = 3;

export interface PacerOptions {
  schedule: Schedule;
  /** Relógio monotônico em ms. */
  now: () => number;
  /** Tamanho de um pedaço de 20 ms no formato de quem recebe. */
  frameBytes: number;
  write(frame: Buffer): void;
  /** Falso: o caminho fechou, e o compasso para. */
  isOpen(): boolean;
  /**
   * Com um quadro de silêncio, o compasso nunca para: quando não há fala, sai silêncio. Sem ele,
   * o compasso só corre enquanto há fala na fila.
   */
  silence?: Buffer;
}

export interface Pacer {
  /** Fala do agente, em pedaços de qualquer tamanho. */
  push(pcm: Buffer): void;
  /** Descarta o que ainda não saiu (quem ligou falou por cima). */
  clear(): void;
  /** Resolve quando a fala na fila terminou de sair. */
  drained(): Promise<void>;
  /** Começa o compasso contínuo. Só vale com `silence`; sem ela, quem começa é `push`. */
  start(): void;
  stop(): void;
}

/**
 * A fala do agente na cadência real, em pedaços de 20 ms. O motor gera mais rápido que o tempo
 * real, e é a cadência que faz o `clear` (quem fala por cima) cortar a fala na hora, em vez de
 * sobrar uma fila inteira já entregue do outro lado. Na ligação pelo WhatsApp ela é também o que
 * não deixa a fala se perder: o WaCalls guarda no máximo 240 ms e descarta o resto.
 *
 * O compasso conta pedaços desde o começo, e não 20 ms a partir do último: o atraso de um timer
 * não se acumula. Depois de um engasgo, sai no máximo `MAX_BURST_FRAMES` de uma vez, e o resto do
 * atraso é perdido, não despejado.
 */
export function createPacer(options: PacerOptions): Pacer {
  const { frameBytes, silence } = options;
  let queue: Buffer = Buffer.alloc(0);
  let running = false;
  let stopped = false;
  /** Saiu fala no último tick: ela ainda leva 20 ms para tocar do outro lado. */
  let speaking = false;
  let cancelTick: (() => void) | undefined;
  let epoch = 0;
  let sent = 0;
  const waiters: Array<() => void> = [];

  const wake = (): void => {
    for (const resolve of waiters.splice(0)) resolve();
  };

  const halt = (): void => {
    running = false;
    speaking = false;
    cancelTick?.();
    cancelTick = undefined;
    queue = Buffer.alloc(0);
    wake();
  };

  const tick = (): void => {
    cancelTick = undefined;
    if (stopped || !options.isOpen()) return halt();
    const elapsedFrames = Math.floor((options.now() - epoch) / FRAME_MS);
    const due = Math.min(MAX_BURST_FRAMES, elapsedFrames + 1 - sent);
    let wrote = 0;
    while (wrote < due && queue.length > 0) {
      const frame = queue.subarray(0, frameBytes);
      queue = queue.subarray(frameBytes);
      // O último pedaço da fala é completado com silêncio: do outro lado, pedaço curto vira atraso.
      options.write(silence && frame.length < frameBytes ? Buffer.concat([frame, silence.subarray(frame.length)]) : frame);
      wrote += 1;
    }
    const spoke = wrote > 0;
    if (silence) for (; wrote < due; wrote += 1) options.write(silence);
    if (due > 0) sent = elapsedFrames + 1;
    const busy = spoke || queue.length > 0;
    if (speaking && !busy) wake();
    speaking = busy;
    if (busy || silence) cancelTick = options.schedule(tick, FRAME_MS);
    else halt();
  };

  const begin = (): void => {
    if (running || stopped) return;
    running = true;
    epoch = options.now();
    sent = 0;
    tick();
  };

  return {
    push(pcm) {
      if (stopped || pcm.length === 0) return;
      queue = Buffer.concat([queue, pcm]);
      // Sem silêncio, a fala dá a partida; com silêncio, quem dá a partida é `start`, e a fala
      // espera na fila até lá.
      if (!silence) begin();
    },
    clear() {
      queue = Buffer.alloc(0);
    },
    drained: () => (queue.length > 0 || speaking ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve()),
    start() {
      if (silence) begin();
    },
    stop() {
      stopped = true;
      halt();
    },
  };
}
