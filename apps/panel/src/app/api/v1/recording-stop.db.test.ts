import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordingPath, withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { putSetting } from "../../../../../../packages/tools/test/helpers";
import { startCallSession, stopRecordingOfLiveCall, type CallSession } from "../../../../../voice/src/call-session";
import { startInternalApi } from "../../../../../voice/src/internal-api";
import { createAgent, createCall, eventsOf, kindsOf, manualEngine, manualTransport, sessionHarness, type SessionHarness } from "../../../../../voice/src/testing/db";
import { waitFor } from "../../../../../voice/src/testing/helpers";
import { call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { POST as stopRoute } from "./calls/[id]/recording/pause/route";

/**
 * O botão do painel contra a chamada de verdade: a rota fala com a API interna do processo de voz,
 * que acha a sessão viva e para o gravador. Nada aqui é dublê, além do motor e da telefonia.
 */
const panel = startPanel();
const INTERNAL_TOKEN = "internal-test-token";
const sessions = new Set<CallSession>();
const unused = async (): Promise<never> => {
  throw new Error("not part of this test");
};
const voice = await startInternalApi({
  port: 0,
  host: "127.0.0.1",
  token: INTERNAL_TOKEN,
  handlers: {
    health: unused,
    applyTrunks: unused,
    outbound: unused,
    simulate: unused,
    web: unused,
    whatsappCalls: { state: unused, connect: unused, disconnect: unused },
    // A mesma ligação do `server.ts`.
    stopRecording: (input) => stopRecordingOfLiveCall(sessions, input),
  },
});
const harnesses: SessionHarness[] = [];
const dirs: string[] = [];

beforeEach(() => {
  panel.deps.fetch = (input, init) => fetch(input, init);
  panel.deps.voiceUrl = `http://127.0.0.1:${voice.port}`;
  panel.deps.internalToken = INTERNAL_TOKEN;
});
afterAll(async () => {
  await voice.close();
  for (const harness of harnesses) await harness.approvals.close();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  await panel.close();
});

/** Uma chamada no ar, numa sessão de verdade, com a gravação ligada ou não na organização. */
async function liveCall(label: string, recording: boolean) {
  const app = panel.app;
  const organizationId = await createOrganization(app, label);
  const operator = await createUser(app, organizationId, "operator");
  const manual = manualEngine({ keyless: true });
  const agentId = await createAgent(app, organizationId, { engine: "manual", greeting: "Bom dia." });
  if (recording) await putSetting(app, organizationId, "calls.recording_enabled", true, false);
  const harness = await sessionHarness(app, [manual.engine]);
  harnesses.push(harness);
  const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-panel-stop-"));
  dirs.push(dir);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now());
  const transport = manualTransport();
  const session = startCallSession({ ...harness.deps, recordingsDir: dir }, { organizationId, callId, agentId, transport });
  sessions.add(session);
  void session.done.then(() => sessions.delete(session));
  await waitFor(async () => (await kindsOf(app, callId)).includes("recording_notice"), "the notice event");
  return { organizationId, operator, callId, transport, session, file: recordingPath(dir, organizationId, callId) };
}

const stop = (cookie: string, callId: string, reason?: string | null) => call(stopRoute, { method: "POST", cookie, params: { id: callId }, body: reason === undefined ? {} : { reason } });
const pauseOf = (callId: string) =>
  withSystem(panel.app, (q) =>
    q.one<{ recording_paused_by: string | null; recording_pause_reason: string | null; recording_paused_at: Date | null }>(
      "select recording_paused_by, recording_pause_reason, recording_paused_at from calls where id = $1",
      [callId],
    ),
  );

describe("o pedido do painel para parar a gravação", { timeout: 120_000 }, () => {
  it("chega à chamada viva, para o gravador e registra quem pediu; o que se diz depois não entra no arquivo", async () => {
    const live = await liveCall("panel stop recording", true);
    live.transport.callerAudio(200); // a fala em que a pessoa pediu
    await new Promise((resolve) => setTimeout(resolve, 120)); // deixa o quadro chegar ao gravador

    const answer = await stop(live.operator.cookie, live.callId, "  A pessoa pediu para não gravar  ");

    expect([answer.status, answer.data]).toEqual([200, { recording: "stopped" }]);
    expect(await pauseOf(live.callId)).toMatchObject({ recording_paused_by: "human", recording_pause_reason: "A pessoa pediu para não gravar", recording_paused_at: expect.any(Date) });
    expect((await eventsOf(panel.app, live.callId)).find((event) => event.kind === "recording_paused")?.payload).toEqual({
      by: "human",
      userId: live.operator.id,
      reason: "A pessoa pediu para não gravar",
    });
    expect((await stop(live.operator.cookie, live.callId)).data).toEqual({ recording: "already_stopped" });

    live.transport.callerAudio(100); // dito DEPOIS do pedido
    live.transport.callerHangup();
    await live.session.done;
    // 8 kHz, 16 bits, dois canais: 32 bytes por milissegundo de áudio.
    const audio = (await readFile(live.file)).length - 44;
    expect(audio).toBeGreaterThan(200 * 32 * 0.8);
    expect(audio).toBeLessThan(300 * 32 * 0.9);
    // Encerrada, a chamada não aceita mais pedido.
    expect([(await stop(live.operator.cookie, live.callId)).status]).toEqual([404]);
  });

  it("sem gravação, responde que a chamada não está sendo gravada e não grava nada como parada", async () => {
    const live = await liveCall("panel stop not recorded", false);

    expect((await stop(live.operator.cookie, live.callId, null)).data).toEqual({ recording: "not_recording" });

    live.transport.callerHangup();
    await live.session.done;
    expect(await kindsOf(panel.app, live.callId)).not.toContain("recording_paused");
    expect(await pauseOf(live.callId)).toEqual({ recording_paused_by: null, recording_pause_reason: null, recording_paused_at: null });
  });

  it("a chamada de outra empresa não existe para quem pede, e nada para", async () => {
    const live = await liveCall("panel stop owner org", true);
    const otherOrg = await createOrganization(panel.app, "panel stop other org");
    const stranger = await createUser(panel.app, otherOrg, "owner");

    const answer = await stop(stranger.cookie, live.callId);

    expect([answer.status, answer.code]).toEqual([404, "not_found"]);
    live.transport.callerHangup();
    await live.session.done;
    expect(await kindsOf(panel.app, live.callId)).not.toContain("recording_paused");
  });

  it("chamada aberta no banco que o processo de voz não conduz: a tela recebe o motivo, sem prometer parada", async () => {
    const organizationId = await createOrganization(panel.app, "panel stop orphan");
    const operator = await createUser(panel.app, organizationId, "operator");
    const agentId = await createAgent(panel.app, organizationId, { engine: "manual" });
    const callId = await createCall(panel.app, organizationId, agentId, new Date("2026-03-01T15:00:00.000Z"));

    const answer = await stop(operator.cookie, callId);

    expect([answer.status, answer.code]).toEqual([422, "call_not_live"]);
    expect(await pauseOf(callId)).toEqual({ recording_paused_by: null, recording_pause_reason: null, recording_paused_at: null });
  });
});
