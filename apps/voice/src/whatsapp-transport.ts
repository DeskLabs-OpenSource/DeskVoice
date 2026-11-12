import { resample } from "@deskvoice/voice-engine";
import { RTCPeerConnection, type PeerConfig } from "werift";
import { messageOf, type Logger } from "./log";
import { createPacer } from "./pacer";
import { FRAME_MS, SAMPLE_RATE, type CallTransport, type Schedule } from "./transport";

/**
 * O áudio do WaCalls: PCM16 LE mono a 16 kHz nos dois sentidos, num canal de dados WebRTC de rótulo
 * `pcm` que o par cria (`internal/app/session/bridge.go:12-14, 37-47`, commit `d16a076`).
 */
export const WHATSAPP_SAMPLE_RATE = 16_000;
export const PCM_CHANNEL = "pcm";
const WHATSAPP_FRAME_BYTES = (WHATSAPP_SAMPLE_RATE / 1000) * FRAME_MS * 2;
const SILENCE = Buffer.alloc(WHATSAPP_FRAME_BYTES);
// Teto do áudio de quem ligou guardado à espera de quem ouça (a sessão ainda abre o motor): 5 s a 8 kHz.
const MAX_HELD_BYTES = 5 * 16_000;

/**
 * O par fica na rede interna do Compose, ao lado do WaCalls: nenhum servidor STUN (o padrão da
 * biblioteca consultaria um do Google), nenhum candidato além dos endereços do contêiner.
 */
export const PEER_CONFIG: Partial<PeerConfig> = { iceServers: [], iceUseDefaultStunServer: false, iceUseIpv6: false, iceUseTcp: false };

/** A ligação no WaCalls, do jeito que o transporte precisa dela. */
export interface WhatsAppLeg {
  /** Entrega a oferta SDP ao WaCalls e devolve a resposta. */
  exchange(offerSdp: string): Promise<string>;
  /** Desliga a ligação no WaCalls. */
  end(): Promise<void>;
}

export interface WhatsAppTransport extends CallTransport {
  /** O WaCalls disse `connected`: o áudio com o WhatsApp está de pé, e a fala pode sair. */
  mediaConnected(): void;
  /** A ligação terminou do lado do WhatsApp (quem ligou desligou, ou o WaCalls a encerrou). */
  remoteEnded(): void;
}

export interface WhatsAppTransportOptions {
  schedule: Schedule;
  /** Relógio monotônico em ms, para a cadência. */
  now: () => number;
  log: Logger;
  /** Só para teste: o par falso escuta no loopback. */
  peerConfig?: Partial<PeerConfig>;
}

/**
 * `CallTransport` da ligação pelo WhatsApp. Este processo faz o papel que o navegador faz no
 * WaCalls: abre a conexão WebRTC, cria o canal `pcm`, e por ele passa o áudio, convertido entre os
 * 16 kHz do WaCalls e os 8 kHz da borda dos motores.
 *
 * A fala do agente sai na cadência real (o WaCalls guarda no máximo 240 ms e descarta o mais
 * antigo, `internal/voip/extension/audio/audio.go:71-81`) e, enquanto o agente não fala, sai
 * silêncio. O silêncio não é para a chamada não cair: quem cai com 5 s sem mídia é a perna com o
 * WhatsApp, e o próprio WaCalls manda silêncio a ela quando não tem o que mandar
 * (`audio.go:101-127`). É para o fim da fala sair: o WaCalls só codifica quadros cheios de 60 ms, e
 * sem nada atrás o último pedaço de cada fala ficaria preso no buffer dele até a fala seguinte.
 *
 * Nada sai antes de o WaCalls dizer `connected`: antes disso ele não tem para onde mandar o áudio,
 * guarda só os últimos 240 ms, e a saudação chegaria cortada.
 *
 * Não há para onde transferir: a ligação não passa pelo Asterisk, e o WaCalls não transfere
 * (decisão 6A do desenho). A conversa lê `canTransfer` e nunca pede.
 */
export async function openWhatsAppTransport(leg: WhatsAppLeg, options: WhatsAppTransportOptions): Promise<WhatsAppTransport> {
  const { log } = options;
  const peer = new RTCPeerConnection({ ...PEER_CONFIG, ...options.peerConfig });
  // Ordenado e confiável, como o cliente do próprio WaCalls (`client/src/lib/call/audio-channel.ts`).
  const channel = peer.createDataChannel(PCM_CHANNEL, { ordered: true });

  let audioHandler: ((pcm: Buffer) => void) | undefined;
  let hangupHandler: (() => void) | undefined;
  let held: Buffer[] = [];
  let heldBytes = 0;
  let mediaUp = false;
  let left = false;
  let remoteGone = false;
  let released: Promise<void> | undefined;

  const open = (): boolean => !left && released === undefined && channel.readyState === "open";
  const pacer = createPacer({ schedule: options.schedule, now: options.now, frameBytes: WHATSAPP_FRAME_BYTES, silence: SILENCE, isOpen: open, write: (frame) => channel.send(frame) });
  const startIfReady = (): void => {
    if (mediaUp && open()) pacer.start();
  };

  /** Quem ligou saiu, ou a perna caiu: avisa a conversa uma vez. Quem solta a perna é `close`. */
  const callerLeft = (): void => {
    if (left || released) return;
    left = true;
    held = [];
    pacer.stop();
    hangupHandler?.();
  };

  /** Solta a perna: para a cadência, fecha a conexão e, se a ligação ainda existe, desliga no WaCalls. */
  const release = (): Promise<void> =>
    (released ??= (async () => {
      pacer.stop();
      await peer.close().catch((error: unknown) => log("error", "could not close the WhatsApp peer connection", { error: messageOf(error) }));
      if (!remoteGone) await leg.end().catch((error: unknown) => log("error", "could not end the call in WaCalls", { error: messageOf(error) }));
    })());

  channel.stateChange.subscribe((state) => {
    if (state === "open") startIfReady();
    else if (state === "closed") callerLeft();
  });
  channel.onMessage.subscribe((data) => {
    if (typeof data === "string" || data.length < 2 || left) return;
    // Meia amostra no fim não é áudio: o PCM16 tem dois bytes por amostra.
    const pcm = resample(data.subarray(0, data.length - (data.length % 2)), WHATSAPP_SAMPLE_RATE, SAMPLE_RATE);
    if (audioHandler) audioHandler(pcm);
    else if (heldBytes + pcm.length <= MAX_HELD_BYTES) {
      held.push(pcm);
      heldBytes += pcm.length;
    }
  });
  peer.connectionStateChange.subscribe((state) => {
    // Sem o par, o WaCalls segura a ligação 30 s esperando outra oferta (`session.go:55-57`); aqui
    // não há quem a refaça, então a conversa acaba agora, e `close` desliga no WaCalls.
    if (state === "failed" || state === "closed") callerLeft();
  });

  try {
    // Sem candidatos aos poucos: `setLocalDescription` espera a coleta, como o cliente do WaCalls.
    await peer.setLocalDescription(await peer.createOffer());
    const offer = peer.localDescription?.sdp;
    if (!offer) throw new Error("The WebRTC offer has no SDP");
    await peer.setRemoteDescription({ type: "answer", sdp: await leg.exchange(offer) });
  } catch (error) {
    await peer.close().catch((closing: unknown) => log("error", "could not close a WhatsApp peer connection that never opened", { error: messageOf(closing) }));
    throw error;
  }

  return {
    canTransfer: false,
    onAudio(handler) {
      audioHandler = handler;
      for (const pcm of held.splice(0)) handler(pcm);
      heldBytes = 0;
    },
    sendAudio(pcm) {
      if (!left && released === undefined && pcm.length > 0) pacer.push(resample(pcm, SAMPLE_RATE, WHATSAPP_SAMPLE_RATE));
    },
    clearAudio: () => pacer.clear(),
    onHangup(handler) {
      hangupHandler = handler;
      if (left) handler();
    },
    async hangup() {
      await pacer.drained();
      await release();
    },
    // Nunca chamado: `canTransfer` é falso. Se for, a ligação termina em vez de ficar presa.
    async transfer() {
      await pacer.drained();
      await release();
    },
    close: release,
    mediaConnected() {
      mediaUp = true;
      startIfReady();
    },
    remoteEnded() {
      remoteGone = true;
      callerLeft();
    },
  };
}
