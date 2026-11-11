import { afterEach, describe, expect, it } from "vitest";
import type { VoiceSession, VoiceSessionConfig } from "../types";
import defaultEngine, { createSimulatedEngine, setSimulatedScript, SIMULATED_PREFIX, type SimulatedScript } from "./simulated";

const config: VoiceSessionConfig = { instructions: "Você é a recepção.", language: "pt-BR", tools: [] };
const audio = (ms: number): Buffer => Buffer.alloc(ms * 16);

/** Agendador manual: o teste decide quando o roteiro anda, sem relógio. */
function manualScheduler() {
  const queue: Array<() => void> = [];
  return {
    schedule: (task: () => void) => void queue.push(task),
    flush() {
      for (let task = queue.shift(); task; task = queue.shift()) task();
    },
  };
}

function record(session: VoiceSession): string[] {
  const log: string[] = [];
  session.on("transcript", (turn) => log.push(`${turn.speaker}: ${turn.text}`));
  session.on("audio", (pcm) => {
    if (log.at(-1)?.startsWith("audio ")) log[log.length - 1] = `audio ${Number(log.at(-1)?.slice(6)) + pcm.length}`;
    else log.push(`audio ${pcm.length}`);
  });
  session.on("toolCall", (call) => log.push(`tool ${call.id} ${call.name} ${JSON.stringify(call.args)}`));
  session.on("usage", (usage) => log.push(`usage ${usage.seconds}`));
  session.on("error", (error) => log.push(`error ${error.message}`));
  session.on("closed", (reason) => log.push(`closed ${reason}`));
  return log;
}

afterEach(() => setSimulatedScript(undefined));

describe("motor simulado", () => {
  it("executa o roteiro completo: say, expectUserAudio, toolCall que bloqueia, fail", async () => {
    const scheduler = manualScheduler();
    const engine = createSimulatedEngine({ schedule: scheduler.schedule });
    setSimulatedScript([
      { say: "Olá" },
      { expectUserAudio: 100, text: "quero remarcar" },
      { toolCall: { name: "request_approval", args: { question: "pode?" } } },
      { say: "Feito" },
      { fail: "motor caiu" },
    ]);
    const session = await engine.connect(config, "");
    const log = record(session);

    scheduler.flush();
    // "Olá" = 3 caracteres x 50 ms = 150 ms -> 8 quadros de 20 ms (320 bytes cada).
    expect(log).toEqual(["agent: Olá", "audio 2560"]);

    session.sendAudio(audio(60));
    scheduler.flush();
    expect(log).toHaveLength(2);
    session.sendAudio(audio(40));
    scheduler.flush();
    expect(log.slice(2)).toEqual(["user: quero remarcar", 'tool sim-1 request_approval {"question":"pode?"}']);

    // Bloqueado até o resultado com o mesmo id: mais áudio ou um id errado não destravam.
    session.sendAudio(audio(500));
    session.sendToolResult("outro-id", {});
    scheduler.flush();
    expect(log.slice(4)).toEqual(["error simulated: resultado para uma chamada de ferramenta que não está pendente: outro-id"]);

    session.sendToolResult("sim-1", { ok: true });
    scheduler.flush();
    // "Feito" = 250 ms -> 13 quadros. Total: 160 + 260 ms falados + 600 ms recebidos = 1,02 s.
    expect(log.slice(5)).toEqual(["agent: Feito", "audio 4160", "usage 1.02", "error motor caiu", "closed failed"]);

    await session.close();
    scheduler.flush();
    expect(log.filter((line) => line.startsWith("closed"))).toEqual(["closed failed"]);
  });

  it("aceita o roteiro em config.instructions e fala a saudação antes dele", async () => {
    const scheduler = manualScheduler();
    const engine = createSimulatedEngine({ schedule: scheduler.schedule });
    const script: SimulatedScript = [{ say: "Tchau" }, { end: true }];
    const session = await engine.connect(
      { ...config, instructions: SIMULATED_PREFIX + JSON.stringify(script), greeting: "Bom dia" },
      "",
    );
    const log = record(session);
    scheduler.flush();
    expect(log.filter((line) => !line.startsWith("audio"))).toEqual(["agent: Bom dia", "agent: Tchau", "usage 0.62", "closed ended"]);
  });

  it("roteiro sem end fica aberto; say() fala fora do roteiro; close() é idempotente", async () => {
    const scheduler = manualScheduler();
    const engine = createSimulatedEngine({ schedule: scheduler.schedule });
    setSimulatedScript([{ say: "Oi" }]);
    const session = await engine.connect(config, "");
    const log = record(session);
    scheduler.flush();
    session.say("Esta ligação é gravada");
    scheduler.flush();
    expect(log.filter((line) => !line.startsWith("audio"))).toEqual(["agent: Oi", "agent: Esta ligação é gravada"]);
    await session.close();
    await session.close();
    expect(log.filter((line) => line.startsWith("closed"))).toEqual(["closed client"]);
  });

  it("recusa roteiro inválido", async () => {
    await expect(defaultEngine.connect({ ...config, instructions: `${SIMULATED_PREFIX}[{"dance":1}]` }, "")).rejects.toThrow();
    expect(() => setSimulatedScript([{ expectUserAudio: -5 }])).toThrow();
  });

  it("com o agendador padrão anda sozinho, sem chave", async () => {
    expect(defaultEngine.keyless).toBe(true);
    const session = await defaultEngine.connect({ ...config, instructions: `${SIMULATED_PREFIX}[{"say":"Oi"},{"end":true}]` }, "");
    const log = record(session);
    await new Promise<void>((resolve) => session.on("closed", () => resolve()));
    expect(log.at(-1)).toBe("closed ended");
  });
});
