/**
 * Servidor do protocolo AudioSocket do Asterisk (TCP puro).
 *
 * O protocolo e as lições abaixo foram portados do módulo de voz do DeskcommCRM
 * (workers/voice-agent/audioSocketBridge.ts; MIT, mesmo autor; ver CREDITS.md):
 *
 * - Quadro: `[tipo:1][tamanho:2 big-endian][dados]`. O Asterisk conecta em nós (`AudioSocket()` no
 *   dialplan) e o primeiro quadro é o UUID, que identifica a chamada.
 * - A cadência de saída é nossa. O protocolo é só bytes, sem carimbo de tempo: o motor de voz gera
 *   mais rápido que o tempo real, e escrever tudo de uma vez faz o Asterisk tocar acelerado e
 *   picado. Sai um quadro de 320 bytes a cada 20 ms.
 * - `setNoDelay`: sem isso o algoritmo de Nagle junta os quadros pequenos e o áudio sai picado
 *   mesmo com a cadência certa.
 * - Áudio que chega antes de haver quem ouça é guardado, não descartado: quem fala assim que a
 *   ligação atende não perde a primeira frase.
 */
import { createServer, type Socket } from "node:net";
import { silentLogger, type Logger } from "./log";
import { FRAME_BYTES, FRAME_MS, realSchedule, type Schedule } from "./transport";

const FRAME = { HANGUP: 0x00, UUID: 0x01, DTMF: 0x03, AUDIO: 0x10, ERROR: 0xff } as const;
const HEADER_BYTES = 3;
const UUID_BYTES = 16;
// O Asterisk manda 320 bytes por quadro de áudio. Tamanho muito acima disso é fluxo corrompido ou
// alguém que não é o Asterisk: a conexão fecha em vez de acumular memória.
const MAX_PAYLOAD_BYTES = 4096;
// Depois de um engasgo do processo, no máximo este número de quadros sai de uma vez; o resto do
// atraso é perdoado, porque rajada longa toca acelerada.
const MAX_BURST_FRAMES = 3;
// Teto do áudio guardado à espera de quem ouça: 5 s.
const MAX_HELD_FRAMES = 250;
const HANDSHAKE_TIMEOUT_MS = 5000;

/** `hangup`: o Asterisk avisou o fim. `closed`: a conexão caiu sem aviso. `local`: fechamos nós. */
export type AudioSocketCloseReason = "hangup" | "closed" | "protocol_error" | "local";

export interface AudioSocketConnection {
  /** UUID do primeiro quadro, no formato 8-4-4-4-12. É o id da chamada. */
  readonly id: string;
  onAudio(handler: (pcm16_8k: Buffer) => void): void;
  onDtmf(handler: (digit: string) => void): void;
  /** Dispara uma vez. Registrado depois do fechamento, dispara na hora. */
  onClose(handler: (reason: AudioSocketCloseReason) => void): void;
  sendAudio(pcm16_8k: Buffer): void;
  clearAudio(): void;
  /** Resolve quando tudo o que foi enfileirado saiu (ou a conexão fechou). */
  drained(): Promise<void>;
  close(): void;
}

export interface AudioSocketServerOptions {
  port: number;
  host?: string;
  onConnection(connection: AudioSocketConnection): void;
  schedule?: Schedule;
  /** Relógio monotônico em ms, para a cadência não derivar com o atraso dos timers. */
  now?: () => number;
  log?: Logger;
}

export interface AudioSocketServer {
  port: number;
  close(): Promise<void>;
}

function frame(type: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header[0] = type;
  header.writeUInt16BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class Connection implements AudioSocketConnection {
  private audioHandler: ((pcm: Buffer) => void) | undefined;
  private dtmfHandler: ((digit: string) => void) | undefined;
  private closeHandlers: Array<(reason: AudioSocketCloseReason) => void> = [];
  private held: Buffer[] = [];
  private closedWith: AudioSocketCloseReason | undefined;

  private queue: Buffer = Buffer.alloc(0);
  private pacing = false;
  private cancelTick: (() => void) | undefined;
  private epoch = 0;
  private sent = 0;
  private drainWaiters: Array<() => void> = [];

  constructor(
    readonly id: string,
    private readonly socket: Socket,
    private readonly schedule: Schedule,
    private readonly now: () => number,
  ) {}

  onAudio(handler: (pcm: Buffer) => void): void {
    this.audioHandler = handler;
    for (const pcm of this.held.splice(0)) handler(pcm);
  }

  onDtmf(handler: (digit: string) => void): void {
    this.dtmfHandler = handler;
  }

  onClose(handler: (reason: AudioSocketCloseReason) => void): void {
    if (this.closedWith !== undefined) handler(this.closedWith);
    else this.closeHandlers.push(handler);
  }

  receiveAudio(pcm: Buffer): void {
    if (this.audioHandler) this.audioHandler(pcm);
    else if (this.held.length < MAX_HELD_FRAMES) this.held.push(pcm);
  }

  receiveDtmf(digit: string): void {
    this.dtmfHandler?.(digit);
  }

  sendAudio(pcm: Buffer): void {
    if (this.closedWith !== undefined || pcm.length === 0) return;
    this.queue = Buffer.concat([this.queue, pcm]);
    if (this.pacing) return;
    this.pacing = true;
    this.epoch = this.now();
    this.sent = 0;
    this.tick();
  }

  clearAudio(): void {
    this.queue = Buffer.alloc(0);
  }

  drained(): Promise<void> {
    if (!this.pacing) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  close(): void {
    this.end("local");
  }

  /** Único ponto de fechamento: roda uma vez, por qualquer motivo. */
  end(reason: AudioSocketCloseReason): void {
    if (this.closedWith !== undefined) return;
    this.closedWith = reason;
    this.cancelTick?.();
    this.stopPacing();
    // Fechar o TCP é o sinal para o Asterisk seguir o dialplan. Quadro de desligar (0x00) não é
    // enviado: ele derrubaria o canal, e a transferência precisa do canal vivo.
    this.socket.destroySoon();
    for (const handler of this.closeHandlers.splice(0)) handler(reason);
  }

  /** Roda a cada 20 ms enquanto há fala: escreve os quadros que o relógio já deve, nunca a fila toda. */
  private tick(): void {
    this.cancelTick = undefined;
    if (this.closedWith !== undefined) return;
    const elapsedFrames = Math.floor((this.now() - this.epoch) / FRAME_MS);
    const due = Math.min(MAX_BURST_FRAMES, elapsedFrames + 1 - this.sent);
    let wrote = 0;
    while (wrote < due && this.queue.length >= FRAME_BYTES) {
      this.socket.write(frame(FRAME.AUDIO, this.queue.subarray(0, FRAME_BYTES)));
      this.queue = this.queue.subarray(FRAME_BYTES);
      wrote += 1;
    }
    if (due > 0 && wrote === 0 && this.queue.length > 0) {
      // Sobrou menos de um quadro e nada novo chegou em 20 ms: é o fim de uma fala. Completa com
      // silêncio, senão a última sílaba ficaria presa na fila.
      const last = Buffer.alloc(FRAME_BYTES);
      this.queue.copy(last);
      this.queue = Buffer.alloc(0);
      this.socket.write(frame(FRAME.AUDIO, last));
      wrote = 1;
    }
    // Em dia com o relógio: fila que secou não vira crédito para uma rajada depois.
    if (due > 0) this.sent = elapsedFrames + 1;
    // Depois do último quadro ainda corre um tick: ele leva 20 ms para tocar do outro lado.
    if (wrote > 0 || this.queue.length > 0) this.cancelTick = this.schedule(() => this.tick(), FRAME_MS);
    else this.stopPacing();
  }

  private stopPacing(): void {
    this.pacing = false;
    this.queue = Buffer.alloc(0);
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }
}

export function startAudioSocketServer(options: AudioSocketServerOptions): Promise<AudioSocketServer> {
  const schedule = options.schedule ?? realSchedule;
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? silentLogger;
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    let buffer: Buffer = Buffer.alloc(0);
    let connection: Connection | undefined;
    let dead = false;

    const fail = (why: string): void => {
      dead = true;
      log("error", "audiosocket protocol error; closing the connection", { why, callId: connection?.id });
      if (connection) connection.end("protocol_error");
      else socket.destroy();
    };

    // Conexão que abre e nunca se identifica não fica pendurada.
    const cancelHandshake = schedule(() => {
      if (!connection && !dead) fail("no UUID frame after connecting");
    }, HANDSHAKE_TIMEOUT_MS);

    const handle = (type: number, payload: Buffer): void => {
      if (!connection) {
        if (type !== FRAME.UUID || payload.length !== UUID_BYTES) return fail("first frame is not a 16-byte UUID");
        cancelHandshake();
        connection = new Connection(formatUuid(payload), socket, schedule, now);
        options.onConnection(connection);
        return;
      }
      // `Buffer.from`: o pedaço recebido é reaproveitado pelo socket; quem ouve pode guardar o áudio.
      if (type === FRAME.AUDIO) connection.receiveAudio(Buffer.from(payload));
      else if (type === FRAME.DTMF) connection.receiveDtmf(payload.toString("ascii"));
      else if (type === FRAME.HANGUP) connection.end("hangup");
      else if (type === FRAME.ERROR) {
        log("error", "asterisk reported an audiosocket error", { callId: connection.id, code: payload[0] });
        connection.end("hangup");
      } else if (type === FRAME.UUID) fail("second UUID frame");
      // Tipo desconhecido: ignorado. O protocolo pode ganhar tipos, e o tamanho já diz onde o quadro acaba.
    };

    socket.on("data", (chunk: Buffer) => {
      if (dead) return;
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      // Um pacote TCP pode trazer meio quadro ou vários: só sai daqui quadro inteiro.
      while (!dead && buffer.length >= HEADER_BYTES) {
        const type = buffer.readUInt8(0);
        const length = buffer.readUInt16BE(1);
        if (length > MAX_PAYLOAD_BYTES) return fail(`frame of ${length} bytes`);
        if (buffer.length < HEADER_BYTES + length) return;
        const payload = buffer.subarray(HEADER_BYTES, HEADER_BYTES + length);
        buffer = buffer.subarray(HEADER_BYTES + length);
        handle(type, payload);
      }
    });
    socket.on("error", (error) => log("error", "audiosocket connection error", { callId: connection?.id, error: error.message }));
    socket.on("close", () => {
      sockets.delete(socket);
      cancelHandshake();
      connection?.end("closed");
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("AudioSocket server has no TCP address"));
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            for (const socket of sockets) socket.destroy();
          }),
      });
    });
  });
}
