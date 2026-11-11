import { connect, type Socket } from "node:net";
import type { Schedule } from "../transport";

/** Relógio e agendador manuais: o teste decide quando o tempo anda. */
export function manualTime(): { schedule: Schedule; now: () => number; advance(ms: number): void; stall(ms: number): void; pending(): number } {
  let now = 0;
  let timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => now,
    schedule(fn, delayMs) {
      const timer = { at: now + delayMs, fn };
      timers.push(timer);
      return () => {
        timers = timers.filter((candidate) => candidate !== timer);
      };
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((timer) => timer !== next);
        now = next.at;
        next.fn();
      }
      now = target;
    },
    // O processo engasgou: o tempo passou e só agora os timers vencidos rodam, uma vez cada.
    stall(ms) {
      now += ms;
      for (const timer of timers.filter((candidate) => candidate.at <= now)) {
        timers = timers.filter((candidate) => candidate !== timer);
        timer.fn();
      }
    },
    pending: () => timers.length,
  };
}

/** Espera uma condição que depende de rede ou de banco, sem dormir tempo fixo. */
export async function waitFor<T>(probe: () => T | Promise<T>, what: string, timeoutMs = 30_000): Promise<NonNullable<T>> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export function audioSocketFrame(type: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(3);
  header[0] = type;
  header.writeUInt16BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export interface FakeAsterisk {
  socket: Socket;
  /** Quadros recebidos do servidor, já separados. */
  frames: Array<{ type: number; payload: Buffer }>;
  closed: boolean;
  send(type: number, payload: Buffer): void;
  raw(bytes: Buffer): void;
  sendUuid(uuid: string): void;
  /** `ms` de áudio de quem ligou, em quadros de 20 ms. */
  sendAudio(ms: number): void;
  hangup(): void;
}

/** O lado do Asterisk no AudioSocket: um cliente TCP de verdade. */
export async function fakeAsterisk(port: number): Promise<FakeAsterisk> {
  const socket = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.setNoDelay(true);
  let buffer: Buffer = Buffer.alloc(0);
  const client: FakeAsterisk = {
    socket,
    frames: [],
    closed: false,
    send: (type, payload) => void socket.write(audioSocketFrame(type, payload)),
    raw: (bytes) => void socket.write(bytes),
    sendUuid: (uuid) => client.send(0x01, Buffer.from(uuid.replaceAll("-", ""), "hex")),
    sendAudio(ms) {
      for (let sent = 0; sent < ms; sent += 20) client.send(0x10, Buffer.alloc(320));
    },
    hangup() {
      client.send(0x00, Buffer.alloc(0));
      socket.end();
    },
  };
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 3 && buffer.length >= 3 + buffer.readUInt16BE(1)) {
      const length = buffer.readUInt16BE(1);
      client.frames.push({ type: buffer.readUInt8(0), payload: buffer.subarray(3, 3 + length) });
      buffer = buffer.subarray(3 + length);
    }
  });
  socket.on("error", () => undefined);
  socket.on("close", () => {
    client.closed = true;
  });
  return client;
}
