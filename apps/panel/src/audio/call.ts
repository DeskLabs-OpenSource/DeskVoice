import { CAPTURE_PROCESSOR, CAPTURE_WORKLET_SOURCE } from "./capture-worklet";
import { VOICE_RATE, createFramer, createPcmDecoder, createResampler, floatToPcm16, pcm16ToFloat, rms } from "./pcm";

export type MicProblem = "insecure" | "denied" | "no_device" | "unavailable";
export class MicError extends Error {
  constructor(readonly problem: MicProblem) {
    super(problem);
  }
}

/** Pede o microfone. Cada motivo de falha tem nome próprio, para a tela dizer o que fazer. */
export async function openMicrophone(): Promise<MediaStream> {
  // Fora de HTTPS (ou de localhost) o navegador nem expõe o microfone.
  if (!window.isSecureContext) throw new MicError("insecure");
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError("unavailable");
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw new MicError("denied");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicError("no_device");
    throw new MicError("unavailable");
  }
}

export type CallEnd = { status: string; reason: string } | { problem: "connection_lost" | "session_expired" };

export interface VoiceCallHandlers {
  /** O agente atendeu: a conversa começou. */
  onReady(): void;
  onEnded(end: CallEnd): void;
  /** Cerca de dez vezes por segundo: nível do microfone (0 a 1) e se há fala do agente tocando. */
  onMeter(meter: { micLevel: number; agentSpeaking: boolean }): void;
}

export interface VoiceCall {
  setMuted(muted: boolean): void;
  hangup(): void;
  /** Solta microfone, áudio e conexão. Seguro chamar mais de uma vez. */
  dispose(): void;
}

// Folga antes de tocar o primeiro pedaço depois de um silêncio: cobre a variação da rede sem
// virar atraso perceptível.
const LEAD_SECONDS = 0.06;
// Teto do que fica agendado para tocar. O agente pode entregar uma frase inteira mais rápido do
// que ela leva para ser dita, então a fila precisa caber uma fala longa; acima disso alguma coisa
// travou, e o que chega é descartado em vez de virar atraso que só cresce.
const MAX_QUEUE_SECONDS = 20;
const METER_MS = 100;
// Se o servidor não confirmar o desligamento, a chamada encerra do lado de cá mesmo assim.
const HANGUP_GRACE_MS = 2500;

function parseMessage(text: string): { type?: unknown; status?: unknown; reason?: unknown } {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}

/**
 * Liga o microfone ao processo de voz e a fala do agente ao alto-falante.
 *
 * Captura: microfone → bloco a bloco → 8000 Hz → quadros de 20 ms → conexão.
 * Reprodução: cada pedaço que chega é agendado no relógio do áudio logo depois do anterior,
 * então não há estalo nas emendas nem atraso acumulando.
 */
export async function startVoiceCall(stream: MediaStream, url: string, handlers: VoiceCallHandlers): Promise<VoiceCall> {
  const context = new AudioContext();
  const moduleUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  // Sem esperar: o contexto só sai da pausa depois de um gesto da pessoa, e travar aqui deixaria
  // a tela presa em "conectando" se o navegador demorar a liberar.
  void context.resume();

  const capture = new AudioWorkletNode(context, CAPTURE_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
  // O nó de captura só é processado se estiver ligado à saída; o ganho zero garante que a própria
  // voz não volte no alto-falante.
  const silence = context.createGain();
  silence.gain.value = 0;
  context.createMediaStreamSource(stream).connect(capture).connect(silence).connect(context.destination);

  const downsample = createResampler(context.sampleRate, VOICE_RATE);
  const upsample = createResampler(VOICE_RATE, context.sampleRate);
  const frame = createFramer();
  const decode = createPcmDecoder();
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";

  const playing = new Set<AudioBufferSourceNode>();
  let playUntil = 0;
  let muted = false;
  let level = 0;
  let finished = false;
  let disposed = false;

  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const block = event.data;
    level = muted ? 0 : Math.max(rms(block), level * 0.85);
    // Mudo manda silêncio no mesmo ritmo: a conexão continua viva e o agente não "ouve" um corte.
    const voice = downsample(muted ? new Float32Array(block.length) : block);
    if (socket.readyState !== WebSocket.OPEN) return;
    for (const bytes of frame(floatToPcm16(voice))) socket.send(bytes);
  };

  const play = (chunk: ArrayBuffer): void => {
    const samples = upsample(pcm16ToFloat(decode(chunk)));
    if (samples.length === 0 || context.state === "closed") return;
    const now = context.currentTime;
    if (playUntil < now + LEAD_SECONDS) playUntil = now + LEAD_SECONDS;
    if (playUntil - now > MAX_QUEUE_SECONDS) return;
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.copyToChannel(samples, 0);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    node.onended = () => playing.delete(node);
    node.start(playUntil);
    playing.add(node);
    playUntil += buffer.duration;
  };

  // A pessoa falou por cima: o que o agente ainda ia dizer é descartado na hora.
  const clear = (): void => {
    for (const node of playing) {
      node.onended = null;
      node.stop();
    }
    playing.clear();
    playUntil = 0;
  };

  const meter = setInterval(() => handlers.onMeter({ micLevel: level, agentSpeaking: context.state !== "closed" && context.currentTime < playUntil }), METER_MS);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearInterval(meter);
    window.removeEventListener("pagehide", leave);
    capture.port.onmessage = null;
    for (const track of stream.getTracks()) track.stop();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    if (context.state !== "closed") void context.close();
  };

  const finish = (end: CallEnd): void => {
    if (finished) return;
    finished = true;
    // O microfone para já; o que o agente ainda tem para dizer (a despedida) termina de tocar.
    for (const track of stream.getTracks()) track.stop();
    const remaining = context.state === "closed" ? 0 : Math.max(0, playUntil - context.currentTime);
    setTimeout(dispose, Math.min(remaining, MAX_QUEUE_SECONDS) * 1000);
    handlers.onEnded(end);
  };

  const hangup = (): void => {
    if (finished) return;
    clear();
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "hangup" }));
    setTimeout(() => finish({ status: "completed", reason: "caller_hangup" }), HANGUP_GRACE_MS);
  };

  // Fechar a aba ou sair da página desliga a chamada: ninguém fica falando com um agente sem ouvinte.
  function leave(): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "hangup" }));
    dispose();
  }
  window.addEventListener("pagehide", leave);

  socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
    if (typeof event.data !== "string") return play(event.data);
    const message = parseMessage(event.data);
    if (message.type === "ready") handlers.onReady();
    else if (message.type === "clear") clear();
    else if (message.type === "ended") finish({ status: String(message.status ?? "completed"), reason: String(message.reason ?? "") });
  };
  // Fechou sem dizer por quê: ou o convite venceu (4401), ou a conexão caiu.
  socket.onclose = (event) => finish({ problem: event.code === 4401 ? "session_expired" : "connection_lost" });

  return {
    setMuted(next) {
      muted = next;
    },
    hangup,
    dispose() {
      if (!finished && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "hangup" }));
      finished = true;
      dispose();
    },
  };
}
