import type WebSocket from "ws";
import { FRAME_BYTES, FRAME_MS, type CallTransport, type Schedule } from "./transport";

// Teto do áudio guardado à espera de quem ouça (a sessão ainda está abrindo o motor): 5 s.
const MAX_HELD_BYTES = 5 * 16_000;
// Depois de um engasgo do processo, no máximo este número de pedaços sai de uma vez.
const MAX_BURST_FRAMES = 3;

export interface WebTransport extends CallTransport {
  /** Áudio que chegou do navegador. */
  receiveAudio(pcm: Buffer): void;
  /** O navegador desligou (mensagem `hangup`) ou o socket fechou sem aviso. */
  callerLeft(): void;
  /** Diz ao navegador como a chamada terminou e fecha o socket. Só a primeira chamada vale. */
  end(status: string, reason: string): void;
}

/**
 * `CallTransport` sobre o WebSocket da chamada pelo navegador. O áudio é o mesmo PCM16 mono
 * 8 kHz da telefonia; só muda por onde ele passa.
 *
 * A fala do agente sai na cadência real, em pedaços de até 20 ms: o motor gera mais rápido que o
 * tempo real, e é a cadência que faz o `clear` (quem fala por cima) cortar a fala na hora, em vez
 * de sobrar uma fila inteira já entregue ao navegador.
 *
 * No navegador não há para onde transferir o áudio. A transferência fica registrada como em
 * qualquer chamada (o evento e o resumo ao humano são o que importa) e a conversa termina pelo
 * caminho de transferência: quem está na tela recebe `ended` com `status: "transferred"`.
 */
export function createWebTransport(socket: WebSocket, options: { schedule: Schedule; now: () => number }): WebTransport {
  let audioHandler: ((pcm: Buffer) => void) | undefined;
  let hangupHandler: (() => void) | undefined;
  let held: Buffer[] = [];
  let heldBytes = 0;
  let left = false;
  let ended = false;

  let queue: Buffer = Buffer.alloc(0);
  let pacing = false;
  let cancelTick: (() => void) | undefined;
  let epoch = 0;
  let sent = 0;
  const drainWaiters: Array<() => void> = [];

  const open = (): boolean => !ended && !left && socket.readyState === socket.OPEN;
  const text = (message: object): void => {
    if (open()) socket.send(JSON.stringify(message));
  };

  const stopPacing = (): void => {
    pacing = false;
    cancelTick?.();
    cancelTick = undefined;
    queue = Buffer.alloc(0);
    for (const resolve of drainWaiters.splice(0)) resolve();
  };

  const tick = (): void => {
    cancelTick = undefined;
    if (!open()) return stopPacing();
    const elapsedFrames = Math.floor((options.now() - epoch) / FRAME_MS);
    const due = Math.min(MAX_BURST_FRAMES, elapsedFrames + 1 - sent);
    let wrote = 0;
    while (wrote < due && queue.length > 0) {
      socket.send(queue.subarray(0, FRAME_BYTES), { binary: true });
      queue = queue.subarray(FRAME_BYTES);
      wrote += 1;
    }
    if (due > 0) sent = elapsedFrames + 1;
    // Depois do último pedaço ainda corre um tick: ele leva 20 ms para tocar do outro lado.
    if (wrote > 0 || queue.length > 0) cancelTick = options.schedule(tick, FRAME_MS);
    else stopPacing();
  };

  const drained = (): Promise<void> => (pacing ? new Promise((resolve) => drainWaiters.push(resolve)) : Promise.resolve());

  return {
    onAudio(handler) {
      audioHandler = handler;
      for (const pcm of held.splice(0)) handler(pcm);
      heldBytes = 0;
    },
    receiveAudio(pcm) {
      if (audioHandler) audioHandler(pcm);
      else if (heldBytes + pcm.length <= MAX_HELD_BYTES) {
        held.push(pcm);
        heldBytes += pcm.length;
      }
    },
    sendAudio(pcm) {
      if (!open() || pcm.length === 0) return;
      queue = Buffer.concat([queue, pcm]);
      if (pacing) return;
      pacing = true;
      epoch = options.now();
      sent = 0;
      tick();
    },
    clearAudio() {
      queue = Buffer.alloc(0);
      text({ type: "clear" });
    },
    onHangup(handler) {
      hangupHandler = handler;
      if (left) handler();
    },
    callerLeft() {
      if (left || ended) return;
      left = true;
      held = [];
      stopPacing();
      hangupHandler?.();
    },
    // Os três só esperam a fala sair: quem diz `ended` e fecha o socket é `end`, chamado quando
    // a conversa terminou de gravar tudo e o desfecho é conhecido.
    hangup: drained,
    transfer: () => drained(),
    async close() {
      stopPacing();
    },
    end(status, reason) {
      if (ended) return;
      text({ type: "ended", status, reason });
      ended = true;
      stopPacing();
      if (socket.readyState === socket.OPEN) socket.close(1000);
    },
  };
}
