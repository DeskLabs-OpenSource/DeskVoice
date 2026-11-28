/// <reference lib="dom" />
// O que a sonda põe na página da reunião antes de ela carregar (Playwright `addInitScript`).
// É a troca do microfone e a mistura das faixas da seção 4 do desenho
// (docs/specs/2026-11-23-canal-de-reunioes.md), e é exatamente isso que a fatia 1 prova ou não.
//
// - O microfone vira uma faixa WebAudio (`MediaStreamAudioDestinationNode`): o que a sonda toca
//   nela é o que a reunião ouve. A câmera, se pedida, é um quadro preto.
// - Cada faixa de áudio que chega por `RTCPeerConnection` entra num só misturador, e o que sai dele
//   é gravado em PCM16 na taxa do contexto (em geral 48 kHz).
// - Os números do WebRTC (pacotes de áudio enviados e recebidos) vêm do `getStats` das conexões.
//
// A função roda dentro do navegador: não pode usar nada de fora dela.

export interface PageCapture {
  sampleRate: number;
  /** PCM16 mono, little-endian, em base64. */
  base64: string;
}

export interface RtcNumbers {
  connections: number;
  audioTracksIn: number;
  packetsSent: number;
  packetsReceived: number;
  /** `totalAudioEnergy` do `media-source`: se o que a sonda tocou chegou ao envio. */
  sentAudioEnergy: number;
}

export interface SondaNaPagina {
  play(base64: string, sampleRate: number): Promise<void>;
  startRecording(): void;
  stopRecording(): PageCapture;
  rtc(): Promise<RtcNumbers>;
}

declare global {
  interface Window {
    __sonda?: SondaNaPagina;
  }
}

export function installInPage(): void {
  let context: AudioContext | undefined;
  let microphone: MediaStreamAudioDestinationNode | undefined;
  let mixer: GainNode | undefined;
  let recording = false;
  const chunks: Int16Array[] = [];
  const connections: RTCPeerConnection[] = [];
  const keep: unknown[] = [];
  let audioTracksIn = 0;

  const audio = (): { ctx: AudioContext; mic: MediaStreamAudioDestinationNode; mix: GainNode } => {
    if (!context) {
      context = new AudioContext();
      microphone = context.createMediaStreamDestination();
      mixer = context.createGain();
      // ScriptProcessor é antigo, mas não precisa de módulo externo (a página da reunião pode
      // barrar `blob:` para o AudioWorklet). A saída vai a um ganho zero: o nó só roda ligado.
      const tap = context.createScriptProcessor(4096, 1, 1);
      tap.onaudioprocess = (event) => {
        if (!recording) return;
        const input = event.inputBuffer.getChannelData(0);
        const out = new Int16Array(input.length);
        for (let i = 0; i < input.length; i += 1) out[i] = Math.max(-32768, Math.min(32767, Math.round(input[i]! * 32767)));
        chunks.push(out);
      };
      const mute = context.createGain();
      mute.gain.value = 0;
      mixer.connect(tap);
      tap.connect(mute);
      mute.connect(context.destination);
      keep.push(tap, mute);
    }
    return { ctx: context, mic: microphone!, mix: mixer! };
  };

  const blackVideo = (): MediaStreamTrack => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    canvas.getContext("2d")?.fillRect(0, 0, 320, 180);
    return canvas.captureStream(1).getVideoTracks()[0]!;
  };

  const devices = navigator.mediaDevices;
  if (devices) {
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = new MediaStream();
      if (constraints?.audio) stream.addTrack(audio().mic.stream.getAudioTracks()[0]!.clone());
      if (constraints?.video) stream.addTrack(blackVideo());
      return stream;
    };
  }

  const Original = window.RTCPeerConnection;
  if (Original) {
    const Wrapped = function (this: RTCPeerConnection, ...args: ConstructorParameters<typeof RTCPeerConnection>) {
      const pc = new Original(...args);
      connections.push(pc);
      pc.addEventListener("track", (event) => {
        if (event.track.kind !== "audio") return;
        audioTracksIn += 1;
        const stream = new MediaStream([event.track]);
        // Versões antigas do Chrome só faziam o áudio remoto correr no WebAudio com a faixa também
        // num elemento de mídia. Na prova em laço do Chromium 159 não fez falta; fica porque a
        // reunião real não foi medida. O elemento é mudo: quem ouve é o misturador.
        const element = new Audio();
        element.muted = true;
        element.srcObject = stream;
        void element.play().catch(() => undefined);
        const { ctx, mix } = audio();
        const source = ctx.createMediaStreamSource(stream);
        source.connect(mix);
        keep.push(element, source);
      });
      return pc;
    } as unknown as typeof RTCPeerConnection;
    Wrapped.prototype = Original.prototype;
    Object.setPrototypeOf(Wrapped, Original);
    window.RTCPeerConnection = Wrapped;
  }

  window.__sonda = {
    async play(base64, sampleRate) {
      const { ctx, mic } = audio();
      if (ctx.state === "suspended") await ctx.resume();
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      const buffer = ctx.createBuffer(1, bytes.length / 2, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(mic);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    },
    startRecording() {
      const { ctx } = audio();
      void ctx.resume();
      chunks.length = 0;
      recording = true;
    },
    stopRecording() {
      recording = false;
      const length = chunks.reduce((n, c) => n + c.length, 0);
      const bytes = new Uint8Array(length * 2);
      const view = new DataView(bytes.buffer);
      let at = 0;
      for (const chunk of chunks) for (const s of chunk) view.setInt16((at++) * 2, s, true);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { sampleRate: audio().ctx.sampleRate, base64: btoa(binary) };
    },
    async rtc() {
      const numbers = { connections: connections.length, audioTracksIn, packetsSent: 0, packetsReceived: 0, sentAudioEnergy: 0 };
      for (const pc of connections) {
        if (pc.connectionState === "closed") continue;
        const report = await pc.getStats();
        report.forEach((s: Record<string, unknown>) => {
          if (s.kind !== "audio") return;
          if (s.type === "outbound-rtp") numbers.packetsSent += Number(s.packetsSent ?? 0);
          if (s.type === "inbound-rtp") numbers.packetsReceived += Number(s.packetsReceived ?? 0);
          if (s.type === "media-source") numbers.sentAudioEnergy += Number(s.totalAudioEnergy ?? 0);
        });
      }
      return numbers;
    },
  };
}

/**
 * O texto que vai para `addInitScript`. O `tsx` (esbuild) acrescenta chamadas `__name(...)` às
 * funções, e na página esse nome não existe: sem o `__name` local, o script quebra calado e a
 * sonda fica sem microfone e sem escuta (achado na prova com o Chromium, 27/11/2026).
 */
export const pageScript = (): string => `(() => { const __name = (fn) => fn; (${installInPage.toString()})(); })();`;
