import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import gemini from "./engines/gemini-live";
import openai from "./engines/openai-realtime";
import { startFakeProvider } from "./testing/fake-provider";
import { EngineTimeoutError, type VoiceSessionConfig } from "./types";

const config: VoiceSessionConfig = { instructions: "Você atende a clínica.", greeting: "Bom dia.", language: "pt-BR", tools: [] };
const engines = [openai, gemini];
let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

/** Agendador nas mãos do teste: o prazo só vence quando o teste manda, sem tempo real. */
function manualTimers() {
  const pending: Array<{ fn: () => void; delayMs: number; cancelled: boolean }> = [];
  return {
    pending,
    schedule(fn: () => void, delayMs: number) {
      const entry = { fn, delayMs, cancelled: false };
      pending.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    async waitForTimer(count: number): Promise<void> {
      while (pending.length < count) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe("prazo na abertura da sessão com o provedor", { timeout: 60_000 }, () => {
  for (const engine of engines) {
    it(`${engine.id}: provedor que aceita o TCP e nunca completa o handshake rejeita o connect no prazo`, async () => {
      const sockets: Socket[] = [];
      const server: Server = createServer((socket) => void sockets.push(socket));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      stop = () =>
        new Promise((resolve) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
        });
      const timers = manualTimers();
      const connecting = engine.connect(config, "chave", { baseUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, schedule: timers.schedule });
      const outcome = connecting.then(
        () => "connected",
        (error: unknown) => error,
      );
      await timers.waitForTimer(1);
      expect(timers.pending[0]?.delayMs).toBe(10_000);
      timers.pending[0]?.fn();
      const error = await outcome;
      expect(error).toBeInstanceOf(EngineTimeoutError);
      expect((error as Error).message).toMatch(/não respondeu em 10 s ao abrir a conexão/);
    });

    it(`${engine.id}: provedor que aceita a conexão e nunca confirma a sessão rejeita o connect no prazo e fecha o socket`, async () => {
      const fake = await startFakeProvider();
      stop = () => fake.stop();
      const timers = manualTimers();
      const connecting = engine.connect(config, "chave", { baseUrl: fake.url, schedule: timers.schedule, readyTimeoutMs: 4000 });
      const outcome = connecting.then(
        () => "connected",
        (error: unknown) => error,
      );
      // O primeiro timer é o da abertura (cancelado quando a conexão abre); o segundo, o da sessão.
      await timers.waitForTimer(2);
      expect(timers.pending[0]?.cancelled).toBe(true);
      expect(timers.pending[1]).toMatchObject({ delayMs: 4000, cancelled: false });
      timers.pending[1]?.fn();
      const error = await outcome;
      expect(error).toBeInstanceOf(EngineTimeoutError);
      expect((error as Error).message).toMatch(/não confirmou a sessão em 4 s/);
    });

    it(`${engine.id}: sessão confirmada a tempo cancela o prazo`, async () => {
      const fake = await startFakeProvider();
      stop = () => fake.stop();
      const timers = manualTimers();
      const connecting = engine.connect(config, "chave", { baseUrl: fake.url, schedule: timers.schedule });
      await fake.waitFor((message) => message.type === "session.update" || "setup" in message);
      fake.send(engine.id === "openai-realtime" ? { type: "session.updated", session: {} } : { setupComplete: {} });
      const session = await connecting;
      expect(timers.pending.map((entry) => entry.cancelled)).toEqual([true, true]);
      // Um prazo que disparasse agora não derrubaria nada.
      await session.close();
    });
  }
});
