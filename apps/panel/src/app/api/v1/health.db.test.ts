import { enqueueTask, listenTasks, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_TOKEN, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import type { HealthLine, HealthStatus } from "../../../server/health";
import { POST as agent } from "./system/agent/route";
import { GET as health } from "./system/health/route";

const panel = startPanel();
// A fila é uma só para o banco inteiro. Estes testes vivem em 2001: nenhuma tarefa de outro arquivo
// é elegível nesse "agora", e as sobras deste arquivo são apagadas antes de cada teste.
const T0 = new Date("2001-01-01T12:00:00.000Z");
const later = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);
const stops: Array<() => Promise<void>> = [];

const voiceUp = () => {
  panel.voice.respond = (url) => {
    if (url === "http://voice.test/health") return Response.json({ asterisk: { status: "ok", detail: "connected" }, trunks: [] });
    throw new Error(`unexpected request to ${url}`);
  };
};
beforeEach(async () => {
  panel.clock.at = T0;
  voiceUp();
  await withSystem(panel.app, (q) => q.exec("delete from tasks where run_at < '2002-01-01'"));
});
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});
afterAll(() => panel.close());

interface Report {
  worst: HealthStatus;
  checks: HealthLine[];
  [id: string]: unknown;
}
const read = async (cookie?: string): Promise<Report> => {
  const result = await call(health, { cookie });
  expect(result.status).toBe(200);
  return result.data as Report;
};
const line = (report: Report, id: string): string => {
  const found = report.checks.find((check) => check.id === id);
  return found ? `${found.status} ${found.reason}` : "absent";
};
/** O processo de rotinas no ar: a escuta da fila, como `startRunner` a abre. */
const routinesRunning = async (): Promise<void> => {
  stops.push(await listenTasks(panel.app, () => undefined));
};
const speak = () => call(agent, { method: "POST", body: { version: "0.1.0" }, headers: { authorization: `Bearer ${AGENT_TOKEN}` } });

describe("system health", () => {
  it("without a session: the installation's parts, in order, each also under its id for the terminal check", async () => {
    await routinesRunning();
    const report = await read();
    expect(report.checks.map((check) => check.id)).toEqual(["panel", "database", "voice", "telephony", "routines", "trunk", "engine"]);
    expect(line(report, "routines")).toBe("ok routines_ok");
    // O `install/healthcheck.sh` lê `data.<id>.status` e `data.<id>.detail`.
    for (const id of ["panel", "trunk", "engine"]) {
      expect(report[id]).toMatchObject({ status: expect.stringMatching(/^(ok|warn|fail)$/), detail: expect.any(String) });
    }
    expect(report.panel).toMatchObject({ status: "ok", detail: "respondendo" });
    expect(report.trunk).toMatchObject({ status: "warn", detail: "nenhuma linha cadastrada" });
  });

  it("stopped routines show up: no listener is a failure even with an empty queue, and a stuck queue too", async () => {
    const org = await createOrganization(panel.app, "health routines");
    const owner = await createUser(panel.app, org, "owner");
    // Ninguém escutando: o processo de rotinas parou.
    let report = await read(owner.cookie);
    expect(line(report, "routines")).toBe("fail routines_not_listening");
    expect(report.worst).toBe("fail");

    await routinesRunning();
    expect(line(await read(owner.cookie), "routines")).toBe("ok routines_ok");

    // Escutando, mas uma tarefa vencida há 10 minutos ninguém pegou.
    await withOrg(panel.app, org, (q) => enqueueTask(q, { kind: "summarize_call", payload: {}, runAt: later(-10) }));
    report = await read(owner.cookie);
    expect(line(report, "routines")).toBe("fail routines_stuck");
    expect(report.checks.find((check) => check.id === "routines")?.params).toEqual({ when: later(-10).toISOString() });
  });

  it("with a session: the update agent, from never installed to talking to silent", async () => {
    const org = await createOrganization(panel.app, "health agent");
    const owner = await createUser(panel.app, org, "owner");
    await routinesRunning();
    let report = await read(owner.cookie);
    expect(report.checks.map((check) => check.id)).toEqual(["panel", "database", "voice", "telephony", "routines", "agent", "trunk", "engine", "whatsapp", "whatsapp_calls"]);
    // A fala do agente é copiada para as organizações que existem quando ele fala: esta é nova.
    expect(line(report, "agent")).toBe("warn agent_never");

    expect((await speak()).status).toBe(200);
    report = await read(owner.cookie);
    expect(line(report, "agent")).toBe("ok agent_ok");
    expect(report.checks.find((check) => check.id === "agent")?.params).toEqual({ when: T0.toISOString() });

    panel.clock.at = later(6);
    expect(line(await read(owner.cookie), "agent")).toBe("warn agent_silent");
    // WhatsApp não instalado é o padrão, e não pede atenção.
    expect(line(await read(owner.cookie), "whatsapp")).toBe("ok whatsapp_absent");
  });

  it("with the voice process down: voice fails, and what depends on it says why it could not check", async () => {
    await routinesRunning();
    panel.voice.respond = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const report = await read();
    expect(["voice", "telephony", "trunk"].map((id) => line(report, id))).toEqual(["fail voice_down", "warn needs_voice", "warn needs_voice"]);
    expect(report.worst).toBe("fail");
    expect(report.checks.find((check) => check.id === "voice")?.action).toBe("voice_down");
  });
});
