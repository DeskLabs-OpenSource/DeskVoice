// A conversa sobre um transporte nas mãos do teste: falhas do motor (Review Focus 1 e 2), teto de
// duração e teto de custo.
import { mkdtemp, open, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encryptSecret, recordingPath, withSystem } from "@deskvoice/core";
import type { SimulatedScript } from "@deskvoice/voice-engine";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting, tasksOf } from "../../../packages/tools/test/helpers";
import { EngineTimeoutError } from "@deskvoice/voice-engine";
import { DEFAULT_RECORDING_NOTICE, startCallSession, type CallSession } from "./call-session";
import {
  callOf,
  createAgent,
  createCall,
  createOrganization,
  eventsOf,
  kindsOf,
  ledgerOf,
  manualEngine,
  manualTransport,
  pricedSimulatedEngine,
  secretKey,
  sessionHarness,
  type AgentOptions,
  type ManualEngine,
  type SessionHarness,
} from "./testing/db";
import { waitFor } from "./testing/helpers";
import { failureTone } from "./transport";

const { app, owner } = openTestDbs();
let harness: SessionHarness | undefined;

afterEach(async () => {
  await harness?.approvals.close();
  harness = undefined;
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

async function scene(label: string, agent: AgentOptions, manual?: ManualEngine, direction: "inbound" | "outbound" = "inbound") {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, agent);
  // Um teste pode montar mais de uma cena: a escuta de aprovações da anterior não fica aberta.
  await harness?.approvals.close();
  harness = await sessionHarness(app, manual ? [manual.engine] : [pricedSimulatedEngine(60)]);
  const callId = await createCall(app, organizationId, agentId, harness.clock.now(), direction);
  const transport = manualTransport();
  const start = (): CallSession => startCallSession((harness as SessionHarness).deps, { organizationId, callId, agentId, transport });
  return { organizationId, agentId, callId, transport, start, harness };
}

const summaries = async (organizationId: string) => (await tasksOf(app, organizationId)).filter((task) => task.kind === "summarize_call");

describe("motor que cai no meio da chamada (Review Focus 1)", { timeout: 120_000 }, () => {
  const script: SimulatedScript = [{ say: "Só um momento." }, { fail: "OpenAI Realtime: a conexão caiu (código 1006)" }];

  it("com número de transferência: evento engine_failed, aviso no painel, sinal para quem está na linha e transferência", async () => {
    const { organizationId, callId, transport, start } = await scene("engine-fail-transfer", { script, greeting: "Bom dia.", transferTo: "+5531988887777" });
    expect(await start().done).toEqual({ status: "transferred", endReason: "engine_failed", costCents: expect.any(Number) });

    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual([
      "call_started", "call_answered", "recording_notice", "transcript_agent", "transcript_agent", "engine_failed", "transfer_started", "call_ended", "task_queued",
    ]);
    expect(events[5]?.payload).toEqual({ engine: "simulated", error: "OpenAI Realtime: a conexão caiu (código 1006)" });
    expect(events[6]?.payload).toEqual({ to: "+5531988887777", reason: "engine_failed" });
    expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "engine_failed" });

    // Quem está na linha não fica em silêncio: ouve o sinal de falha e é transferido.
    expect(transport.transferredTo).toBe("+5531988887777");
    expect(transport.hangups).toBe(0);
    const spoken = transport.sentBytes - failureTone().length;
    expect(spoken).toBeGreaterThan(0);
    expect(spoken % 320).toBe(0);

    const notices = await notificationsOf(app, organizationId);
    expect(notices).toMatchObject([{ channel: "panel", call_id: callId }]);
    expect(notices[0]?.body).toMatch(/motor de voz .* caiu no meio de uma ligação.*transferida para \+5531988887777/);
    expect(await summaries(organizationId)).toHaveLength(1);
  });

  it("sem número de transferência: mesmo rastro, sinal e desligamento; a chamada termina como falha", async () => {
    const { organizationId, callId, transport, start } = await scene("engine-fail-hangup", { script });
    expect(await start().done).toMatchObject({ status: "failed", endReason: "engine_failed" });

    expect(await kindsOf(app, callId)).toEqual(["call_started", "call_answered", "recording_notice", "transcript_agent", "transcript_agent", "engine_failed", "call_ended", "task_queued"]);
    expect(await callOf(app, callId)).toMatchObject({ status: "failed", end_reason: "engine_failed", ended_at: expect.any(Date) });
    expect(transport.transferredTo).toBeNull();
    expect(transport.hangups).toBe(1);
    expect(transport.sentBytes).toBeGreaterThanOrEqual(failureTone().length);
    expect((await notificationsOf(app, organizationId))[0]?.body).toMatch(/A ligação foi encerrada, porque o agente não tem número de transferência/);
  });

  it("erro do motor que não fecha a sessão não derruba a chamada", async () => {
    const manual = manualEngine({ keyless: true });
    const { callId, transport, start } = await scene("engine-error-only", { engine: "manual" }, manual);
    const session = start();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
    manual.emit("error", new Error("resposta recusada pelo provedor"));
    manual.emit("transcript", { speaker: "agent", text: "Continuo aqui." });
    await waitFor(async () => (await kindsOf(app, callId)).includes("transcript_agent"), "the transcript");
    expect(await kindsOf(app, callId)).not.toContain("engine_failed");
    expect((await callOf(app, callId)).status).toBe("in_progress");

    transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
    expect(transport.closes).toBe(1);
    expect(transport.hangups).toBe(0);
  });
});

describe("motor sem chave ao atender (Review Focus 2)", { timeout: 120_000 }, () => {
  async function refused(label: string, manual: ManualEngine, setup: (organizationId: string) => Promise<void> = async () => undefined) {
    const made = await scene(label, { engine: "manual", greeting: "Bom dia.", transferTo: "+5531988887777" }, manual);
    await setup(made.organizationId);
    expect(await made.start().done).toEqual({ status: "refused", endReason: "engine_not_configured", costCents: 0 });
    return made;
  }

  it("chave ausente: a chamada não fica muda; call_refused com o motivo, aviso dizendo o que configurar, sinal e desligamento", async () => {
    const manual = manualEngine();
    const { organizationId, callId, transport } = await refused("engine-no-key", manual);

    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual(["call_started", "call_refused", "call_ended", "task_queued"]);
    expect(events[1]?.payload).toEqual({ reason: "engine_not_configured", engine: "manual", detail: "no API key is saved for this voice engine" });
    expect(await callOf(app, callId)).toMatchObject({ status: "refused", end_reason: "engine_not_configured", answered_at: null, ended_at: expect.any(Date) });
    // O motor nem foi chamado, e quem ligou ouviu o sinal antes de a ligação cair.
    expect(manual.configs).toEqual([]);
    expect(transport.sentBytes).toBe(failureTone().length);
    expect(transport.hangups).toBe(1);
    expect(transport.transferredTo).toBeNull();

    const notices = await notificationsOf(app, organizationId);
    expect(notices).toMatchObject([{ channel: "panel", call_id: callId }]);
    expect(notices[0]?.body).toMatch(/recusada.*Motor de teste.*no API key is saved.*Cadastre ou corrija a chave em Configurações/);
    expect(await ledgerOf(app, callId)).toEqual([]);
    expect(await summaries(organizationId)).toHaveLength(1);
  });

  it("chave que não decifra (cifrada com outra chave mestra): recusa do mesmo jeito, sem vazar o valor", async () => {
    const manual = manualEngine();
    const { callId } = await refused("engine-bad-cipher", manual, (organizationId) =>
      putSetting(app, organizationId, "engine.manual.api_key", encryptSecret("sk-segredo-123", Buffer.alloc(32, 7))),
    );
    const refusal = (await eventsOf(app, callId))[1];
    expect(refusal?.payload).toMatchObject({ reason: "engine_not_configured", detail: expect.stringContaining("cannot be read") });
    expect(JSON.stringify(await eventsOf(app, callId))).not.toContain("sk-segredo-123");
    expect(manual.configs).toEqual([]);
  });

  it("chave inválida (o provedor recusa a sessão): recusa com o que o provedor disse", async () => {
    const manual = manualEngine({ connectError: "OpenAI Realtime: não foi possível conectar (código 401)" });
    const { callId, transport } = await refused("engine-invalid-key", manual, (organizationId) =>
      putSetting(app, organizationId, "engine.manual.api_key", encryptSecret("sk-errada", secretKey)),
    );
    expect(manual.keys).toEqual(["sk-errada"]);
    expect((await eventsOf(app, callId))[1]?.payload).toMatchObject({ reason: "engine_not_configured", detail: expect.stringContaining("código 401") });
    expect(transport.hangups).toBe(1);
  });

  it("motor que não existe nesta instalação: recusa", async () => {
    const { callId } = await refused("engine-unknown", manualEngine({ id: "outro" }));
    expect((await eventsOf(app, callId))[1]?.payload).toMatchObject({ detail: 'the voice engine "manual" is not installed' });
  });

  it("com a chave cadastrada, o motor recebe a chave decifrada, as instruções, a voz, o idioma e as ferramentas do agente", async () => {
    const manual = manualEngine();
    const made = await scene("engine-with-key", { engine: "manual", instructions: "Você atende a clínica.", greeting: "Bom dia.", tools: ["end_call", "notify_human", "nao_existe"] }, manual);
    await putSetting(app, made.organizationId, "engine.manual.api_key", encryptSecret("sk-certa", secretKey));
    const session = made.start();
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("call_answered"), "the call to be answered");
    expect(manual.keys).toEqual(["sk-certa"]);
    expect(manual.configs).toMatchObject([{ instructions: "Você atende a clínica.", greeting: `${DEFAULT_RECORDING_NOTICE} Bom dia.`, language: "pt-BR" }]);
    expect(manual.configs[0]?.tools.map((tool) => tool.name)).toEqual(["end_call", "notify_human"]);
    expect(made.harness.logs.some((entry) => entry.message.includes("not installed") && entry.fields?.tool === "nao_existe")).toBe(true);

    // O áudio corre nos dois sentidos, e a interrupção descarta a fala pendente.
    made.transport.callerAudio(60);
    manual.emit("audio", Buffer.alloc(640));
    manual.emit("interrupted");
    expect([manual.audioBytes, made.transport.sentBytes, made.transport.cleared]).toEqual([960, 640, 1]);

    // Ferramenta que o agente não tem habilitada: o modelo é avisado e fica o rastro.
    manual.emit("toolCall", { id: "t1", name: "transfer_to_human", args: {} });
    await waitFor(() => manual.toolResults.length === 1, "the tool result");
    expect(manual.toolResults[0]).toMatchObject({ id: "t1", result: { ok: false } });
    expect((await eventsOf(app, made.callId)).slice(-2)).toMatchObject([
      { kind: "tool_called", payload: { name: "transfer_to_human" } },
      { kind: "tool_result", payload: { name: "transfer_to_human", ok: false } },
    ]);
    made.transport.callerHangup();
    await session.done;
    expect(manual.closed).toBe(1);
  });

  it("na ligação feita pelo agente a saudação não é falada: quem atende fala primeiro", async () => {
    const manual = manualEngine({ keyless: true });
    const made = await scene("engine-outbound", { engine: "manual", greeting: "Bom dia." }, manual, "outbound");
    const session = made.start();
    await waitFor(() => manual.configs.length === 1, "the engine to connect");
    expect(manual.configs[0]?.greeting).toBeUndefined();
    // Sem saudação, o aviso sai assim que a pessoa atende.
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("recording_notice"), "the notice event");
    expect(manual.said).toEqual([DEFAULT_RECORDING_NOTICE]);
    made.transport.callerHangup();
    await session.done;
    expect((await eventsOf(app, made.callId))[0]?.payload).toMatchObject({ direction: "outbound" });
  });
});

describe("provedor de IA que não responde", { timeout: 120_000 }, () => {
  it("connect que nunca volta: no prazo a chamada é recusada com evento, aviso de painel e sinal para quem está na linha", async () => {
    const manual = manualEngine({ keyless: true, connectHangs: true });
    const { organizationId, callId, transport, start, harness } = await scene("engine-hangs", { engine: "manual", greeting: "Bom dia.", transferTo: "+5531988887777" }, manual);
    const session = start();
    await waitFor(() => harness.timers.held().includes(15_000), "the connect deadline");
    expect(await kindsOf(app, callId)).toEqual(["call_started"]);

    expect(harness.timers.fire(15_000)).toBe(1);
    expect(await session.done).toEqual({ status: "refused", endReason: "engine_not_responding", costCents: 0 });
    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual(["call_started", "call_refused", "call_ended", "task_queued"]);
    expect(events[1]?.payload).toEqual({ reason: "engine_not_responding", engine: "manual", detail: expect.stringContaining("did not answer in 15 s") });
    expect(await callOf(app, callId)).toMatchObject({ status: "refused", end_reason: "engine_not_responding" });
    expect(transport.sentBytes).toBe(failureTone().length);
    expect(transport.hangups).toBe(1);
    expect((await notificationsOf(app, organizationId))[0]?.body).toMatch(/provedor do motor de voz Motor de teste não respondeu/);
    expect(harness.timers.held()).toEqual([]);
  });

  it("prazo do próprio motor (EngineTimeoutError): mesma recusa, com o que o motor disse", async () => {
    const manual = manualEngine({ keyless: true, connectError: new EngineTimeoutError("Gemini Live: o provedor não confirmou a sessão em 10 s") });
    const { callId, transport, start, harness } = await scene("engine-timeout", { engine: "manual" }, manual);
    expect(await start().done).toMatchObject({ status: "refused", endReason: "engine_not_responding" });
    expect((await eventsOf(app, callId))[1]?.payload).toMatchObject({ reason: "engine_not_responding", detail: expect.stringContaining("não confirmou a sessão em 10 s") });
    expect(transport.sentBytes).toBe(failureTone().length);
    // O prazo da conversa foi cancelado: nada fica armado.
    expect(harness.timers.held()).toEqual([]);
  });
});

describe("aviso de gravação", { timeout: 120_000 }, () => {
  const OPERATOR_TEXT = "Esta ligação pode ser gravada para a sua segurança.";
  async function answered(label: string, setting?: unknown) {
    const manual = manualEngine({ keyless: true });
    const made = await scene(label, { engine: "manual", greeting: "Clínica Bem Viver, bom dia." }, manual);
    if (setting !== undefined) await putSetting(app, made.organizationId, "recording_notice.text", setting, false);
    const session = made.start();
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("recording_notice"), "the notice event");
    manual.emit("transcript", { speaker: "agent", text: manual.configs[0]?.greeting ?? "" });
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("transcript_agent"), "the opening transcript");
    made.transport.callerHangup();
    await session.done;
    return { manual, events: await eventsOf(app, made.callId) };
  }

  it("instalação sem ajuste: fala o texto padrão, antes da saudação, e o evento vem entre o atendimento e a primeira fala", async () => {
    const { manual, events } = await answered("notice-default");
    expect(manual.configs[0]?.greeting).toBe(`${DEFAULT_RECORDING_NOTICE} Clínica Bem Viver, bom dia.`);
    expect(manual.said).toEqual([]);
    expect(events.slice(0, 4).map((event) => event.kind)).toEqual(["call_started", "call_answered", "recording_notice", "transcript_agent"]);
    expect(events[2]?.payload).toEqual({ text: DEFAULT_RECORDING_NOTICE });
    expect(DEFAULT_RECORDING_NOTICE).toBe("Esta ligação é atendida por uma assistente virtual e a conversa fica registrada.");
  });

  it("o texto do operador substitui o padrão", async () => {
    const { manual, events } = await answered("notice-operator", `  ${OPERATOR_TEXT}  `);
    expect(manual.configs[0]?.greeting).toBe(`${OPERATOR_TEXT} Clínica Bem Viver, bom dia.`);
    expect(events[2]).toEqual({ kind: "recording_notice", payload: { text: OPERATOR_TEXT } });
  });

  it("texto em branco, ou que não é texto, volta ao padrão: o aviso nunca falta", async () => {
    for (const [index, blank] of ["", "   ", null, 42].entries()) {
      const { manual, events } = await answered(`notice-blank-${index}`, blank);
      expect(manual.configs[0]?.greeting, JSON.stringify(blank)).toBe(`${DEFAULT_RECORDING_NOTICE} Clínica Bem Viver, bom dia.`);
      expect(events[2]).toEqual({ kind: "recording_notice", payload: { text: DEFAULT_RECORDING_NOTICE } });
    }
  });

  it("agente sem saudação: a abertura é só o aviso", async () => {
    const manual = manualEngine({ keyless: true });
    const made = await scene("notice-no-greeting", { engine: "manual" }, manual);
    const session = made.start();
    await waitFor(() => manual.configs.length === 1, "the engine to connect");
    expect(manual.configs[0]?.greeting).toBe(DEFAULT_RECORDING_NOTICE);
    made.transport.callerHangup();
    await session.done;
  });

  it("chamada de saída também avisa: sem saudação, o aviso sai por say assim que a pessoa atende", async () => {
    const manual = manualEngine({ keyless: true });
    const made = await scene("notice-outbound", { engine: "manual", greeting: "Bom dia." }, manual, "outbound");
    await putSetting(app, made.organizationId, "recording_notice.text", OPERATOR_TEXT, false);
    const session = made.start();
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("recording_notice"), "the notice event");
    expect(manual.configs[0]?.greeting).toBeUndefined();
    expect(manual.said).toEqual([OPERATOR_TEXT]);
    made.transport.callerHangup();
    await session.done;
    expect((await eventsOf(app, made.callId)).slice(0, 3).map((event) => event.kind)).toEqual(["call_started", "call_answered", "recording_notice"]);
  });
});

describe("gravação do áudio, por organização (registro 0016)", { timeout: 120_000 }, () => {
  /** Uma chamada curta com fala dos dois lados, e onde a gravação dela ficaria. */
  async function talk(label: string, recording?: unknown, minFreeBytes?: number) {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recordings-"));
    const manual = manualEngine({ keyless: true });
    const made = await scene(label, { engine: "manual", greeting: "Bom dia." }, manual);
    if (recording !== undefined) await putSetting(app, made.organizationId, "calls.recording_enabled", recording, false);
    const session = startCallSession({ ...made.harness.deps, recordingsDir: dir, recordingMinFreeBytes: minFreeBytes }, { organizationId: made.organizationId, callId: made.callId, agentId: made.agentId, transport: made.transport });
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("recording_notice"), "the notice event");
    made.transport.callerAudio(200);
    manual.emit("audio", Buffer.alloc(320, 1));
    made.transport.callerHangup();
    await session.done;
    return { dir, callId: made.callId, file: recordingPath(dir, made.organizationId, made.callId), cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("desligada de fábrica: sem a chave, ou com outro valor que não true, nada é gravado", async () => {
    for (const [index, value] of [undefined, false, "true", 1].entries()) {
      const { dir, cleanup } = await talk(`recording-off-${index}`, value);
      expect(await readdir(dir), JSON.stringify(value)).toEqual([]);
      await cleanup();
    }
  });

  it("ligada na organização: a chamada vira um WAV estéreo na pasta dela", async () => {
    const { file, callId, cleanup } = await talk("recording-on", true);
    const wav = await readFile(file);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]); // sem .part
    expect(await kindsOf(app, callId)).not.toContain("recording_skipped");
    expect(await kindsOf(app, callId)).not.toContain("recording_failed");
    await cleanup();
  });

  it("quem ligou desliga com fala na fila: o que não tocou não entra na gravação (issue #109)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recordings-"));
    const manual = manualEngine({ keyless: true });
    const made = await scene("recording-cut-at-end", { engine: "manual", greeting: "Bom dia." }, manual);
    await putSetting(app, made.organizationId, "calls.recording_enabled", true, false);
    const session = startCallSession({ ...made.harness.deps, recordingsDir: dir }, { organizationId: made.organizationId, callId: made.callId, agentId: made.agentId, transport: made.transport });
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("recording_notice"), "the notice event");
    // O motor manda 20 s de fala de uma vez, mais rápido que o tempo real; a ligação cai aos 5 s.
    manual.emit("audio", Buffer.alloc(20 * 8000 * 2, 1));
    made.harness.clock.advance(5000);
    made.transport.callerHangup();
    await session.done;
    const wav = await readFile(recordingPath(dir, made.organizationId, made.callId));
    const seconds = wav.readUInt32LE(40) / (8000 * 2 * 2); // PCM16 estéreo a 8 kHz
    expect(seconds).toBeGreaterThan(4.5);
    expect(seconds).toBeLessThan(5.5);
    await rm(dir, { recursive: true, force: true });
  });

  it("o agente encerra com fala na fila: a gravação guarda a fala inteira, que o transporte toca antes de desligar", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recordings-"));
    const manual = manualEngine({ keyless: true });
    const made = await scene("recording-agent-ends", { engine: "manual", greeting: "Bom dia.", tools: ["end_call"] }, manual);
    await putSetting(app, made.organizationId, "calls.recording_enabled", true, false);
    const session = startCallSession({ ...made.harness.deps, recordingsDir: dir }, { organizationId: made.organizationId, callId: made.callId, agentId: made.agentId, transport: made.transport });
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("recording_notice"), "the notice event");
    // 20 s de despedida de uma vez; o relógio anda 5 s e a ligação é encerrada pelo agente.
    manual.emit("audio", Buffer.alloc(20 * 8000 * 2, 1));
    manual.emit("toolCall", { id: "t1", name: "end_call", args: { reason: "Fim.", farewell: "Até logo." } });
    await waitFor(() => manual.toolResults.length === 1, "the tool result");
    made.harness.clock.advance(5000);
    made.harness.timers.fire(6000);
    await session.done;
    const wav = await readFile(recordingPath(dir, made.organizationId, made.callId));
    expect(wav.readUInt32LE(40) / (8000 * 2 * 2)).toBeGreaterThan(19.5);
    await rm(dir, { recursive: true, force: true });
  });

  it("o disco enche no meio da chamada: recording_failed na hora, a chamada segue e não sobra arquivo (issue #103)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recordings-"));
    const manual = manualEngine({ keyless: true });
    const made = await scene("recording-fails-midway", { engine: "manual", greeting: "Bom dia." }, manual);
    await putSetting(app, made.organizationId, "calls.recording_enabled", true, false);
    const session = startCallSession({ ...made.harness.deps, recordingsDir: dir }, { organizationId: made.organizationId, callId: made.callId, agentId: made.agentId, transport: made.transport });
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("recording_notice"), "the notice event");

    // O `write` de todo arquivo de `fs/promises` passa a falhar como disco cheio.
    const probe = await open(path.join(dir, "probe"), "w");
    const write = vi.spyOn(Object.getPrototypeOf(probe) as { write: () => Promise<unknown> }, "write");
    await probe.close();
    await rm(path.join(dir, "probe"));
    write.mockRejectedValue(Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }));
    try {
      for (let second = 0; second < 3; second += 1) {
        made.harness.clock.advance(1000);
        made.transport.callerAudio(1000);
      }
      await waitFor(async () => (await kindsOf(app, made.callId)).includes("recording_failed"), "the recording failure event");
      // A chamada segue: a fala de quem ligou ainda chega ao motor, e o agente ainda responde.
      const heard = manual.audioBytes;
      made.transport.callerAudio(200);
      expect(manual.audioBytes).toBeGreaterThan(heard);
      manual.emit("audio", Buffer.alloc(320, 1));
      expect(made.transport.sentBytes).toBeGreaterThan(0);
      expect((await callOf(app, made.callId)).status).toBe("in_progress");
      made.transport.callerHangup();
      await session.done;
    } finally {
      write.mockRestore();
    }

    const events = await eventsOf(app, made.callId);
    const kinds = events.map((event) => event.kind);
    expect(events.find((event) => event.kind === "recording_failed")?.payload).toEqual({ reason: "disk_full", error: "ENOSPC: no space left on device, write" });
    expect(kinds.filter((kind) => kind === "recording_failed")).toHaveLength(1);
    expect(kinds.indexOf("recording_failed")).toBeLessThan(kinds.indexOf("call_ended")); // gravado na hora, não no fim
    expect(await callOf(app, made.callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup" });
    expect(await readdir(path.dirname(recordingPath(dir, made.organizationId, made.callId)))).toEqual([]); // nem .wav, nem .part
    await rm(dir, { recursive: true, force: true });
  });

  it("sem espaço livre acima do piso: a chamada segue sem gravar, e a linha do tempo diz por quê", async () => {
    const { dir, callId, cleanup } = await talk("recording-low-disk", true, Number.MAX_SAFE_INTEGER);
    expect(await readdir(dir)).toEqual([]);
    const events = await eventsOf(app, callId);
    const skipped = events.find((event) => event.kind === "recording_skipped");
    expect(skipped?.payload).toEqual({ reason: "low_disk", freeBytes: expect.any(Number), minFreeBytes: Number.MAX_SAFE_INTEGER });
    // A conversa aconteceu e terminou como qualquer outra.
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(["call_answered", "recording_notice", "call_ended"]));
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup" });
    await cleanup();
  });
});

describe("encerrar com despedida", { timeout: 120_000 }, () => {
  it("end_call com farewell: o modelo recebe a despedida para falar uma vez, e só depois a ligação cai", async () => {
    const manual = manualEngine({ keyless: true });
    const { callId, transport, start, harness } = await scene("end-farewell", { engine: "manual", tools: ["end_call"] }, manual);
    const session = start();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");

    manual.emit("toolCall", { id: "t1", name: "end_call", args: { reason: "A cliente se despediu.", farewell: "Foi um prazer, Jéssica! Tenha um ótimo dia." } });
    // A despedida vai no resultado da ferramenta, e o modelo a fala uma vez só: o sistema não a pede de novo.
    await waitFor(() => manual.toolResults.length === 1, "the tool result");
    expect(manual.toolResults[0]?.result).toMatchObject({ ok: true, message: expect.stringContaining('"Foi um prazer, Jéssica! Tenha um ótimo dia."') });
    expect(manual.said).toEqual([]);
    // Ainda falando a despedida: a ligação não caiu.
    expect(transport.hangups).toBe(0);
    expect((await callOf(app, callId)).status).toBe("in_progress");

    expect(harness.timers.fire(6000)).toBe(1);
    expect(await session.done).toMatchObject({ status: "completed", endReason: "end_call" });
    expect(transport.hangups).toBe(1);
  });
});

describe("teclas do menu", { timeout: 120_000 }, () => {
  it("send_dtmf pedido pelo motor chega ao transporte da chamada e deixa o rastro", async () => {
    const manual = manualEngine({ keyless: true });
    const { callId, transport, start } = await scene("send-dtmf", { engine: "manual", tools: ["send_dtmf"] }, manual);
    const session = start();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");

    manual.emit("toolCall", { id: "t1", name: "send_dtmf", args: { digits: "2#" } });
    await waitFor(() => manual.toolResults.length === 1, "the tool result");
    expect(manual.toolResults[0]?.result).toMatchObject({ ok: true, data: { digits: "2#" } });
    expect(transport.sentDtmf).toEqual(["2#"]);
    expect((await eventsOf(app, callId)).filter((event) => event.kind === "dtmf_sent")).toMatchObject([{ payload: { digits: "2#" } }]);

    transport.callerHangup();
    await session.done;
  });
});

describe("tetos da chamada", { timeout: 120_000 }, () => {
  it("duração máxima: o agente se despede e a chamada termina, com o motivo", async () => {
    const manual = manualEngine({ keyless: true });
    const { callId, transport, start, harness } = await scene("ceiling-duration", { engine: "manual", maxCallSeconds: 45, transferTo: "+5531988887777" }, manual);
    const session = start();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
    expect(harness.timers.held()).toContain(45_000);
    expect(manual.said).toEqual([]);

    expect(harness.timers.fire(45_000)).toBe(1);
    expect(manual.said).toEqual([expect.stringContaining("tempo máximo")]);
    // Durante a despedida o que quem ligou diz não vai mais ao motor, e ferramenta não roda.
    transport.callerAudio(100);
    expect(manual.audioBytes).toBe(0);
    manual.emit("toolCall", { id: "t9", name: "end_call", args: { reason: "x" } });
    await waitFor(() => manual.toolResults.length === 1, "the refused tool call");
    expect(manual.toolResults[0]?.result).toMatchObject({ ok: false });
    expect((await callOf(app, callId)).status).toBe("in_progress");

    expect(harness.timers.fire(6000)).toBe(1);
    expect(await session.done).toMatchObject({ status: "completed", endReason: "max_duration" });
    expect(await kindsOf(app, callId)).toEqual(["call_started", "call_answered", "recording_notice", "call_ended", "task_queued"]);
    expect((await eventsOf(app, callId))[3]?.payload).toMatchObject({ status: "completed", reason: "max_duration" });
    expect(transport.hangups).toBe(1);
    expect(transport.transferredTo).toBeNull();
    expect(harness.timers.held()).toEqual([]);
  });

  it("teto de custo sem número de transferência: soma os incrementos de uso, grava o evento, despede e encerra", async () => {
    const manual = manualEngine({ keyless: true, centsPerMinute: 100 });
    const { callId, transport, start, harness } = await scene("ceiling-cost", { engine: "manual", costCeilingCents: 150 }, manual);
    const session = start();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");

    // `usage` é incremento: 60 s + 30 s = 90 s a 100 centavos por minuto = 150 centavos.
    manual.emit("usage", { seconds: 60, inputTokens: 1000 });
    await waitFor(async () => (await callOf(app, callId)).cost_cents === 100, "the first cost");
    expect(manual.said).toEqual([]);
    manual.emit("usage", { seconds: 30, outputTokens: 500 });
    await waitFor(async () => (await kindsOf(app, callId)).includes("cost_ceiling_reached"), "the ceiling event");
    expect(manual.said).toEqual([expect.stringContaining("encerrar esta ligação")]);
    expect((await callOf(app, callId)).status).toBe("in_progress");
    // Uso que chega durante a despedida ainda é medido, e o teto não dispara de novo.
    manual.emit("usage", { seconds: 6 });

    expect(harness.timers.fire(6000)).toBe(1);
    expect(await session.done).toEqual({ status: "completed", endReason: "cost_ceiling", costCents: 160 });
    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual(["call_started", "call_answered", "recording_notice", "cost_ceiling_reached", "call_ended", "task_queued"]);
    expect(events[3]?.payload).toEqual({ costCents: 150, ceilingCents: 150 });
    expect(events[4]?.payload).toEqual({ status: "completed", reason: "cost_ceiling", costCents: 160, seconds: 96 });
    // O extrato tem uma linha por medição, e a soma dele é o custo da chamada.
    expect(await ledgerOf(app, callId)).toEqual([
      { engine: "manual", seconds: 6, input_tokens: 0, output_tokens: 0, cost_cents: 10 },
      { engine: "manual", seconds: 30, input_tokens: 0, output_tokens: 500, cost_cents: 50 },
      { engine: "manual", seconds: 60, input_tokens: 1000, output_tokens: 0, cost_cents: 100 },
    ]);
    expect((await callOf(app, callId)).cost_cents).toBe(160);
    expect(transport.hangups).toBe(1);
  });

  it("teto de custo com número de transferência: avisa que vai transferir e transfere", async () => {
    const manual = manualEngine({ keyless: true, centsPerMinute: 100 });
    const { callId, transport, start, harness } = await scene("ceiling-cost-transfer", { engine: "manual", costCeilingCents: 100, transferTo: "+5531988887777" }, manual);
    const session = start();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
    manual.emit("usage", { seconds: 61 });
    await waitFor(async () => (await kindsOf(app, callId)).includes("transfer_started"), "the transfer to be announced");
    expect(manual.said).toEqual([expect.stringContaining("pessoa da equipe")]);
    harness.timers.fire(6000);
    expect(await session.done).toEqual({ status: "transferred", endReason: "cost_ceiling", costCents: 102 });
    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual(["call_started", "call_answered", "recording_notice", "cost_ceiling_reached", "transfer_started", "call_ended", "task_queued"]);
    expect(events[4]?.payload).toEqual({ to: "+5531988887777", reason: "cost_ceiling" });
    expect(transport.transferredTo).toBe("+5531988887777");
  });

  it("teto zero é sem teto", async () => {
    const manual = manualEngine({ keyless: true, centsPerMinute: 100 });
    const { callId, transport, start } = await scene("ceiling-zero", { engine: "manual", costCeilingCents: 0 }, manual);
    const session = start();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
    manual.emit("usage", { seconds: 600 });
    await waitFor(async () => (await callOf(app, callId)).cost_cents === 1000, "the cost");
    expect(manual.said).toEqual([]);
    transport.callerHangup();
    await session.done;
    expect(await kindsOf(app, callId)).not.toContain("cost_ceiling_reached");
  });
});

describe("gravação a pedido de quem ligou", { timeout: 120_000 }, () => {
  const PEDIDO = "Por favor, não quero que essa conversa fique gravada.";
  const USER = "0c000000-0000-4000-8000-000000000003";

  /** Chamada com a gravação ligada ou não, pronta para o pedido chegar. */
  async function chamada(label: string, recording: boolean) {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recordings-"));
    const manual = manualEngine({ keyless: true });
    const made = await scene(label, { engine: "manual", greeting: "Bom dia.", tools: ["stop_recording"] }, manual);
    if (recording) await putSetting(app, made.organizationId, "calls.recording_enabled", true, false);
    const session = startCallSession(
      { ...made.harness.deps, recordingsDir: dir },
      { organizationId: made.organizationId, callId: made.callId, agentId: made.agentId, transport: made.transport },
    );
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("recording_notice"), "the notice event");
    return { dir, manual, made, session, file: recordingPath(dir, made.organizationId, made.callId) };
  }

  /** `callOf` traz colunas fixas; as da parada ficam de fora, então vão por consulta direta. */
  async function paradaDaChamada(callId: string) {
    return withSystem(app, (q) =>
      q.one<{ recording_paused_by: string | null; recording_pause_reason: string | null; recording_paused_at: Date | null }>(
        "select recording_paused_by, recording_pause_reason, recording_paused_at from calls where id = $1",
        [callId],
      ),
    );
  }

  it("o agente para quando a pessoa pede, e a frase do pedido fica no arquivo e não nos argumentos da ferramenta", async () => {
    const { dir, manual, made, session, file } = await chamada("recording-agent-stop", true);

    made.transport.callerAudio(200); // a fala em que a pessoa pediu
    await new Promise((resolve) => setTimeout(resolve, 120)); // deixa o quadro chegar ao gravador
    manual.emit("toolCall", { id: "t1", name: "stop_recording", args: { reason: PEDIDO } });

    await waitFor(async () => manual.toolResults.length > 0, "o resultado da ferramenta");
    expect(manual.toolResults.at(-1)?.result).toMatchObject({ ok: true, data: { recording: "stopped" } });
    expect(await paradaDaChamada(made.callId)).toMatchObject({ recording_paused_by: "agent", recording_pause_reason: PEDIDO, recording_paused_at: expect.any(Date) });
    const events = await eventsOf(app, made.callId);
    expect(events.find((event) => event.kind === "recording_paused")?.payload).toEqual({ by: "agent", reason: PEDIDO });
    expect(events.find((event) => event.kind === "tool_called")?.payload).toEqual({ name: "stop_recording", args: { omitted: "personal_text" } });

    // Um segundo pedido não registra de novo: a gravação já parou.
    manual.emit("toolCall", { id: "t2", name: "stop_recording", args: { reason: PEDIDO } });
    await waitFor(async () => manual.toolResults.length > 1, "o segundo resultado");
    expect(manual.toolResults.at(-1)?.result).toMatchObject({ ok: true, data: { recording: "already_stopped" } });

    made.transport.callerAudio(100); // dito DEPOIS do pedido: não pode entrar no arquivo
    made.transport.callerHangup();
    await session.done;
    expect((await kindsOf(app, made.callId)).filter((kind) => kind === "recording_paused")).toHaveLength(1);

    // 8 kHz, 16 bits, dois canais: 32 bytes por milissegundo de áudio.
    const wav = await readFile(file);
    const audio = wav.length - 44;
    expect(audio).toBeGreaterThan(200 * 32 * 0.8); // o pedido (200 ms) ficou gravado
    expect(audio).toBeLessThan(300 * 32 * 0.9); // os 100 ms ditos depois da parada, não
    await rm(dir, { recursive: true, force: true });
  });

  it("sem gravação, o agente ouve que a chamada não está sendo gravada, e nada é registrado como parada", async () => {
    const { dir, manual, made, session } = await chamada("recording-agent-off", false);

    manual.emit("toolCall", { id: "t1", name: "stop_recording", args: { reason: PEDIDO } });
    await waitFor(async () => manual.toolResults.length > 0, "o resultado da ferramenta");

    const result = manual.toolResults.at(-1)?.result as { ok: boolean; message: string; data: unknown };
    expect(result).toMatchObject({ ok: true, data: { recording: "not_recording" } });
    expect(result.message).toContain("não está sendo gravada");
    expect(result.message).not.toContain("ficou registrado");
    made.transport.callerHangup();
    await session.done;
    expect(await kindsOf(app, made.callId)).not.toContain("recording_paused");
    expect(await paradaDaChamada(made.callId)).toEqual({ recording_paused_by: null, recording_pause_reason: null, recording_paused_at: null });
    await rm(dir, { recursive: true, force: true });
  });

  it("o pedido do painel que chega enquanto o arquivo ainda abre espera a abertura e para a gravação", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recordings-"));
    const manual = manualEngine({ keyless: true });
    const made = await scene("recording-stop-while-opening", { engine: "manual", greeting: "Bom dia.", tools: ["stop_recording"] }, manual);
    await putSetting(app, made.organizationId, "calls.recording_enabled", true, false);
    const session = startCallSession(
      { ...made.harness.deps, recordingsDir: dir },
      { organizationId: made.organizationId, callId: made.callId, agentId: made.agentId, transport: made.transport },
    );
    // A sessão já existe para o painel, mas o arquivo ainda não abriu: sem esperar, a resposta seria
    // "não está gravando" e a gravação começaria logo depois.
    expect(await session.stopRecording(USER, "não quero ser gravado")).toBe("stopped");
    expect(await paradaDaChamada(made.callId)).toMatchObject({ recording_paused_by: "human", recording_pause_reason: "não quero ser gravado" });
    made.transport.callerHangup();
    await session.done;
    await rm(dir, { recursive: true, force: true });
  });

  it("o pedido do painel para a gravação e registra quem pediu; sem gravação, diz que não havia o que parar", async () => {
    const recorded = await chamada("recording-human-stop", true);
    recorded.made.transport.callerAudio(200);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(await recorded.session.stopRecording(USER, null)).toBe("stopped");
    expect(await paradaDaChamada(recorded.made.callId)).toMatchObject({ recording_paused_by: "human", recording_pause_reason: null });
    expect((await eventsOf(app, recorded.made.callId)).find((event) => event.kind === "recording_paused")?.payload).toEqual({ by: "human", userId: USER });
    expect(await recorded.session.stopRecording(USER, "de novo")).toBe("already_stopped");
    recorded.made.transport.callerHangup();
    await recorded.session.done;
    expect((await readFile(recorded.file)).length).toBeGreaterThan(44);
    // Chamada encerrada: não há mais o que pedir a ela.
    expect(await recorded.session.stopRecording(USER, null)).toBe("call_ended");
    await rm(recorded.dir, { recursive: true, force: true });

    const silent = await chamada("recording-human-off", false);
    expect(await silent.session.stopRecording(USER, "sem gravação")).toBe("not_recording");
    silent.made.transport.callerHangup();
    await silent.session.done;
    expect(await kindsOf(app, silent.made.callId)).not.toContain("recording_paused");
    expect(await paradaDaChamada(silent.made.callId)).toEqual({ recording_paused_by: null, recording_pause_reason: null, recording_paused_at: null });
    await rm(silent.dir, { recursive: true, force: true });
  });
});
