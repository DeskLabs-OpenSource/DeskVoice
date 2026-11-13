import type WebSocket from "ws";
import { createPacer } from "./pacer";
import { FRAME_BYTES, type CallTransport, type Schedule } from "./transport";

// Teto do áudio guardado à espera de quem ouça (a sessão ainda está abrindo o motor): 5 s.
const MAX_HELD_BYTES = 5 * 16_000;

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
 * A fala do agente sai na cadência real, em pedaços de até 20 ms (`pacer.ts`).
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

  const open = (): boolean => !ended && !left && socket.readyState === socket.OPEN;
  const text = (message: object): void => {
    if (open()) socket.send(JSON.stringify(message));
  };
  const pacer = createPacer({ schedule: options.schedule, now: options.now, frameBytes: FRAME_BYTES, isOpen: open, write: (frame) => socket.send(frame, { binary: true }) });

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
      if (open()) pacer.push(pcm);
    },
    clearAudio() {
      pacer.clear();
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
      pacer.stop();
      hangupHandler?.();
    },
    // Os três só esperam a fala sair: quem diz `ended` e fecha o socket é `end`, chamado quando
    // a conversa terminou de gravar tudo e o desfecho é conhecido.
    hangup: pacer.drained,
    transfer: () => pacer.drained(),
    async close() {
      pacer.stop();
    },
    end(status, reason) {
      if (ended) return;
      text({ type: "ended", status, reason });
      ended = true;
      pacer.stop();
      if (socket.readyState === socket.OPEN) socket.close(1000);
    },
  };
}
