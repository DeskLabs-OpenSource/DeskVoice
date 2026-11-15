import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordingPath, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { eventsOf, fakeClock, manualTransport, createOrganization } from "./testing/db";
import { manualTime } from "./testing/helpers";
import { VOICEMAIL_SILENCE_MS, startVoicemailSession } from "./voicemail";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

/**
 * Uma chamada que nasceu sem agente, como a entrada a cria quando vai para o recado: sem `agent_id`,
 * `ringing`, e a organização já conhecida.
 */
async function ringing(organizationId: string): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into calls (id, organization_id, direction, channel, from_e164, to_e164, status, started_at) values ($1, $2, 'inbound', 'phone', $3, $4, 'ringing', $5)", [
      id,
      organizationId,
      "+553****8888",
      "+553****4444",
      fakeClock().now(),
    ]),
  );
  return id;
}

async function folder(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "deskvoice-voicemail-"));
}

const callOf = async (callId: string) =>
  withSystem(app, (q) => q.one<{ status: string; end_reason: string | null; answered_at: Date | null; ended_at: Date | null }>("select status, end_reason, answered_at, ended_at from calls where id = $1", [callId]));

describe("recado quando ninguém pode atender", { timeout: 120_000 }, () => {
  it("quem liga fala, o silêncio encerra e o arquivo fica guardado na pasta das gravações", async () => {
    const organizationId = await createOrganization(app, "voicemail-silence");
    const callId = await ringing(organizationId);
    const dir = await folder();
    const transport = manualTransport();
    const time = manualTime();

    const session = startVoicemailSession({ db: app, clock: fakeClock(), recordingsDir: dir, schedule: time.schedule }, { organizationId, callId, reason: "no_agent", maxSeconds: 60, transport });
    // Fala por 1,2 s e depois nada: o recado acaba no silêncio, não no teto de tempo.
    transport.callerAudio(1200, 8000);
    time.advance(VOICEMAIL_SILENCE_MS);
    const outcome = await session.done;

    expect(outcome).toMatchObject({ status: "completed", endReason: "voicemail", cause: "silence", left: true, seconds: 1.2 });
    expect(transport.hangups).toBe(1);
    expect(await callOf(callId)).toMatchObject({ status: "completed", end_reason: "voicemail", answered_at: expect.any(Date), ended_at: expect.any(Date) });

    const file = recordingPath(dir, organizationId, callId);
    const wav = await readFile(file);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    // 8 kHz, PCM16, dois canais: 32 bytes por milissegundo de chamada.
    expect(wav.length).toBeGreaterThan(1200 * 32);

    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual(["call_started", "voicemail_left", "call_ended"]);
    expect(events[1]?.payload).toMatchObject({ left: true, recorded: true, seconds: 1.2, file, reason: "no_agent", cause: "silence" });
    expect(events[2]?.payload).toMatchObject({ status: "completed", reason: "voicemail", costCents: 0 });
    await rm(dir, { recursive: true, force: true });
  });

  it("gravador que não abre encerra a chamada com o motivo, sem deixar ninguém pendurado", async () => {
    const organizationId = await createOrganization(app, "voicemail-broken-disk");
    const callId = await ringing(organizationId);
    const dir = await folder();
    // A pasta das gravações é um arquivo: o gravador não tem onde escrever.
    const blocked = path.join(dir, "nao-e-pasta");
    await writeFile(blocked, "x");
    const transport = manualTransport();
    const time = manualTime();

    const session = startVoicemailSession({ db: app, clock: fakeClock(), recordingsDir: blocked, schedule: time.schedule }, { organizationId, callId, reason: "no_agent", maxSeconds: 60, transport });
    const outcome = await session.done;

    expect(outcome).toMatchObject({ status: "failed", endReason: "voicemail_failed", cause: "record_failed", left: false, file: null });
    expect(transport.hangups).toBe(1);
    expect(await callOf(callId)).toMatchObject({ status: "failed", end_reason: "voicemail_failed" });
    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual(["call_started", "voicemail_failed", "call_ended"]);
    expect(events[1]?.payload).toMatchObject({ reason: "unavailable" });
    await rm(dir, { recursive: true, force: true });
  });

  it("silêncio até o teto não vira recado: nenhum arquivo, e a linha do tempo diz que ninguém falou", async () => {
    const organizationId = await createOrganization(app, "voicemail-silent");
    const callId = await ringing(organizationId);
    const dir = await folder();
    const transport = manualTransport();
    const time = manualTime();

    const session = startVoicemailSession({ db: app, clock: fakeClock(), recordingsDir: dir, schedule: time.schedule }, { organizationId, callId, reason: "agent_disabled", maxSeconds: 30, transport });
    // A linha fica em silêncio: nem um quadro de fala.
    transport.callerAudio(2000);
    time.advance(30_000);
    const outcome = await session.done;

    expect(outcome).toMatchObject({ status: "completed", endReason: "voicemail", cause: "max_duration", left: false, file: null });
    expect(transport.hangups).toBe(1);
    const events = await eventsOf(app, callId);
    expect(events[1]?.payload).toMatchObject({ left: false, recorded: false, file: null, reason: "agent_disabled" });
    await expect(readFile(recordingPath(dir, organizationId, callId))).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it("quem liga desliga no meio: o que foi falado fica guardado", async () => {
    const organizationId = await createOrganization(app, "voicemail-hangup");
    const callId = await ringing(organizationId);
    const dir = await folder();
    const transport = manualTransport();
    const time = manualTime();

    const session = startVoicemailSession({ db: app, clock: fakeClock(), recordingsDir: dir, schedule: time.schedule }, { organizationId, callId, reason: "no_agent", maxSeconds: 60, transport });
    transport.callerAudio(900, 8000);
    transport.callerHangup();
    const outcome = await session.done;

    expect(outcome).toMatchObject({ status: "completed", endReason: "voicemail", cause: "caller_hangup", left: true });
    // Quem ligou já saiu: a telefonia é solta sem esperar fala nenhuma.
    expect(transport.closes).toBe(1);
    expect(transport.hangups).toBe(0);
    expect((await readFile(recordingPath(dir, organizationId, callId))).length).toBeGreaterThan(900 * 32);
    await rm(dir, { recursive: true, force: true });
  });
});
