// O motor simulado em modo texto (item 7, fatia 7a, seção 5.3 de
// docs/specs/2026-11-21-testes-do-agente.md). O modo de áudio continua em simulated.test.ts, sem
// mudança.
import { describe, expect, it } from "vitest";
import type { VoiceSession, VoiceSessionConfig } from "../types";
import { createSimulatedEngine, SIMULATED_PREFIX, type SimulatedScript } from "./simulated";

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
  session.on("audio", () => void (log.at(-1) === "audio" || log.push("audio")));
  session.on("toolCall", (call) => log.push(`tool ${call.id} ${call.name}`));
  session.on("turnDone", () => log.push("turnDone"));
  session.on("callerTurnEnded", () => log.push("callerTurnEnded"));
  session.on("closed", (reason) => log.push(`closed ${reason}`));
  return log;
}

const script: SimulatedScript = [
  { expectUserAudio: 1000, text: "texto do roteiro" },
  { say: "Vou anotar." },
  { toolCall: { name: "create_task", args: { title: "x" } } },
  { say: "Pronto." },
  { expectUserAudio: 1000 },
  { say: "Tchau." },
];
const config = (mode?: "audio" | "text", greeting?: string): VoiceSessionConfig => ({ instructions: SIMULATED_PREFIX + JSON.stringify(script), language: "pt-BR", tools: [], mode, greeting });

describe("motor simulado em modo texto", () => {
  it("declara textMode", () => {
    expect(createSimulatedEngine().textMode).toBe(true);
  });

  it("a fala chega por sendUserText, o agente responde só em texto, e turnDone sai na espera nova e no fim do roteiro", async () => {
    const clock = manualScheduler();
    const session = await createSimulatedEngine({ schedule: clock.schedule }).connect(config("text", "Olá."), "");
    const log = record(session);
    clock.flush();
    // A abertura: a saudação e a primeira espera.
    expect(log).toEqual(["agent: Olá.", "turnDone"]);

    session.sendUserText?.("Quero remarcar.");
    clock.flush();
    expect(log.slice(2)).toEqual(["user: Quero remarcar.", "agent: Vou anotar.", "tool sim-1 create_task"]);
    session.sendToolResult("sim-1", { ok: true });
    clock.flush();
    expect(log.slice(5)).toEqual(["agent: Pronto.", "turnDone"]);

    session.sendUserText?.("Obrigada.");
    clock.flush();
    // O roteiro termina sem `end`: a resposta acabou, e a sessão fica aberta.
    expect(log.slice(7)).toEqual(["user: Obrigada.", "agent: Tchau.", "turnDone"]);

    // Depois do fim, a fala recebe a resposta vazia.
    session.sendUserText?.("Alô?");
    clock.flush();
    expect(log.slice(10)).toEqual(["user: Alô?", "turnDone"]);
    expect(log).not.toContain("audio");
    expect(log).not.toContain("callerTurnEnded");
  });

  it("sem saudação, a fala mandada antes de o roteiro esperar fica guardada, sem turnDone antes dela", async () => {
    const clock = manualScheduler();
    const session = await createSimulatedEngine({ schedule: clock.schedule }).connect(config("text"), "");
    const log = record(session);
    session.sendUserText?.("Quero remarcar.");
    clock.flush();
    expect(log).toEqual(["user: Quero remarcar.", "agent: Vou anotar.", "tool sim-1 create_task"]);
  });

  it("no modo de áudio, nada muda: sendUserText não faz nada, e turnDone não sai", async () => {
    const clock = manualScheduler();
    for (const mode of [undefined, "audio"] as const) {
      const session = await createSimulatedEngine({ schedule: clock.schedule }).connect(config(mode, "Olá."), "");
      const log = record(session);
      clock.flush();
      session.sendUserText?.("Quero remarcar.");
      clock.flush();
      expect(log).toEqual(["agent: Olá.", "audio"]);
      await session.close();
    }
  });
});
