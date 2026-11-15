import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordingPath, withSystem, type Clock } from "@deskvoice/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, tasksOf } from "../../../packages/tools/test/helpers";
import { createOrganization, eventsOf, manualTransport, t0, type ManualTransport } from "./testing/db";
import { manualTime } from "./testing/helpers";
import { VOICEMAIL_SILENCE_MS, startVoicemailSession, voicemailNotice, voicemailPrompt, type VoicemailInput } from "./voicemail";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

// O aviso de verdade, o embutido, mais o bipe: é o que a sessão põe na fila.
const NOTICE_BYTES = (await voicemailNotice("pt-BR")).length + voicemailPrompt().length;
const NOTICE_MS = NOTICE_BYTES / 16;

/**
 * Transporte que leva o tempo do aviso para tocar, como o real (quadros de 20 ms): `drained` só
 * resolve quando o relógio do teste passou pela duração do que foi enfileirado.
 */
function playingTransport(time: ReturnType<typeof manualTime>): ManualTransport & { drained(): Promise<void>; played: Buffer[] } {
  const base = manualTransport();
  const played: Buffer[] = [];
  let playingUntil = 0;
  return Object.assign(base, {
    played,
    sendAudio(pcm: Buffer) {
      base.sentBytes += pcm.length;
      played.push(pcm);
      playingUntil = Math.max(playingUntil, time.now()) + pcm.length / 16;
    },
    drained: () =>
      new Promise<void>((resolve) => {
        const left = playingUntil - time.now();
        if (left <= 0) resolve();
        else time.schedule(resolve, left);
      }),
  });
}

/** Uma chamada que nasceu sem agente, como a entrada a cria quando vai para o recado. */
async function ringing(organizationId: string): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into calls (id, organization_id, direction, channel, from_e164, to_e164, status, started_at, voicemail) values ($1, $2, 'inbound', 'phone', $3, $4, 'ringing', $5, true)", [
      id,
      organizationId,
      "+5531999998888",
      "+553133334444",
      t0,
    ]),
  );
  return id;
}

const callOf = async (callId: string) =>
  withSystem(app, (q) => q.one<{ status: string; end_reason: string | null; answered_at: Date | null; ended_at: Date | null }>("select status, end_reason, answered_at, ended_at from calls where id = $1", [callId]));

/** Os dois canais do WAV do gravador: esquerdo é quem ligou, direito é o agente (aqui, o aviso). */
function channelsOf(wav: Buffer): { caller: Int16Array; agent: Int16Array } {
  const data = wav.subarray(44);
  const frames = data.length / 4;
  const caller = new Int16Array(frames);
  const agent = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    caller[i] = data.readInt16LE(i * 4);
    agent[i] = data.readInt16LE(i * 4 + 2);
  }
  return { caller, agent };
}

async function voicemail(label: string, options: Partial<Pick<VoicemailInput, "reason" | "maxSeconds">> & { dir?: string } = {}) {
  const organizationId = await createOrganization(app, label);
  const callId = await ringing(organizationId);
  const dir = options.dir ?? (await mkdtemp(path.join(tmpdir(), "deskvoice-voicemail-")));
  const time = manualTime();
  // O relógio da chamada anda com o do teste: o gravador põe cada lado na posição em que tocou.
  const clock: Clock = { now: () => new Date(t0.getTime() + time.now()) };
  const transport = playingTransport(time);
  const session = startVoicemailSession(
    { db: app, clock, recordingsDir: dir, schedule: time.schedule },
    { organizationId, callId, reason: options.reason ?? "no_agent", maxSeconds: options.maxSeconds ?? 60, language: "pt-BR", transport },
  );
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  return {
    organizationId,
    callId,
    dir,
    time,
    transport,
    session,
    /** O aviso entrou na fila do transporte (o arquivo já abriu). */
    noticeQueued: () => vi.waitFor(() => expect(transport.played).toHaveLength(1)),
    /** O relógio chega ao fim do aviso, e a sessão vê que ele terminou de tocar. */
    async noticePlays(): Promise<void> {
      time.advance(Math.max(0, NOTICE_MS - time.now()));
      await settle();
    },
    settle,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe("recado quando ninguém pode atender", { timeout: 120_000 }, () => {
  it("toca o aviso gravado antes de gravar, e nada do que quem ligou disse durante o aviso entra no arquivo", async () => {
    const vm = await voicemail("voicemail-notice-first");
    await vm.noticeQueued();
    expect(vm.transport.played[0]?.length).toBe(NOTICE_BYTES);

    // Quem ligou fala por cima do aviso: 3 s que não podem ser gravados.
    vm.transport.callerAudio(3000, 8000);
    vm.time.advance(NOTICE_MS - 1);
    vm.transport.callerAudio(20, 8000);

    await vm.noticePlays();
    // Depois do aviso: 1,2 s de recado, e o silêncio encerra.
    vm.transport.callerAudio(1200, 8000);
    vm.time.advance(VOICEMAIL_SILENCE_MS);
    const outcome = await vm.session.done;

    expect(outcome).toMatchObject({ status: "completed", endReason: "voicemail", cause: "silence", left: true, recordedSeconds: 1.2 });
    const { caller, agent } = channelsOf(await readFile(recordingPath(vm.dir, vm.organizationId, vm.callId)));
    // Só os 1,2 s depois do aviso: 9600 amostras de quem ligou, e nenhuma enquanto o aviso tocava.
    expect(caller.filter((sample) => sample !== 0)).toHaveLength(1200 * 8);
    // O quadro que chega no fim do aviso cobre os 20 ms antes dele, e o relógio da chamada anda em
    // milissegundos inteiros: o recado começa ali, nunca antes.
    const noticeFrames = NOTICE_MS * 8;
    const firstCallerFrame = (Math.floor(NOTICE_MS) - 20) * 8;
    expect(caller.subarray(0, firstCallerFrame).some((sample) => sample !== 0)).toBe(false);
    expect(caller[firstCallerFrame]).not.toBe(0);
    // O aviso está no canal do agente: a gravação é a prova do que quem ligou ouviu.
    expect(agent.subarray(0, noticeFrames).some((sample) => sample !== 0)).toBe(true);
    await vm.cleanup();
  });

  it("o recado chega a alguém: aviso no painel e o resumo na fila, como toda chamada que termina", async () => {
    const vm = await voicemail("voicemail-notice-panel");
    await vm.noticeQueued();
    await vm.noticePlays();
    vm.transport.callerAudio(1500, 8000);
    vm.time.advance(VOICEMAIL_SILENCE_MS);
    await vm.session.done;

    expect(vm.transport.hangups).toBe(1);
    expect(await callOf(vm.callId)).toMatchObject({ status: "completed", end_reason: "voicemail", answered_at: expect.any(Date), ended_at: expect.any(Date) });
    const notices = await notificationsOf(app, vm.organizationId);
    expect(notices).toMatchObject([{ channel: "panel", call_id: vm.callId }]);
    expect(notices[0]?.body).toBe("Recado novo de +5531999998888 para +553133334444, com 2 s. Ouça em Chamadas.");
    const summary = (await tasksOf(app, vm.organizationId)).filter((task) => task.kind === "summarize_call");
    expect(summary).toMatchObject([{ call_id: vm.callId }]);

    const events = await eventsOf(app, vm.callId);
    expect(events.map((event) => event.kind)).toEqual(["call_started", "voicemail_left", "call_ended", "task_queued"]);
    expect(events[0]?.payload).toMatchObject({ voicemail: "no_agent", language: "pt-BR" });
    expect(events[1]?.payload).toMatchObject({ left: true, recorded: true, recordedSeconds: 1.5, reason: "no_agent", cause: "silence" });
    expect(events[2]?.payload).toMatchObject({ status: "completed", reason: "voicemail", costCents: 0 });
    expect(events[3]?.payload).toMatchObject({ kind: "summarize_call" });
    await vm.cleanup();
  });

  it("o tempo máximo do recado conta a partir do fim do aviso", async () => {
    const vm = await voicemail("voicemail-max-after-notice", { maxSeconds: 5 });
    await vm.noticeQueued();
    // Os 5 s passariam durante o aviso se contassem desde o atendimento.
    vm.time.advance(5000);
    await vm.settle();
    expect(vm.transport.hangups).toBe(0);
    await vm.noticePlays();
    // Fala a cada segundo, para o silêncio nunca encerrar: só o teto encerra.
    for (let second = 0; second < 4; second += 1) {
      vm.transport.callerAudio(100, 8000);
      vm.time.advance(1000);
    }
    vm.transport.callerAudio(100, 8000);
    vm.time.advance(999);
    await vm.settle();
    expect(vm.transport.hangups).toBe(0);

    vm.time.advance(1);
    const outcome = await vm.session.done;
    expect(outcome).toMatchObject({ cause: "max_duration", left: true });
    await vm.cleanup();
  });

  it("quem desliga durante o aviso não deixa recado nem arquivo", async () => {
    const vm = await voicemail("voicemail-hangup-notice");
    await vm.noticeQueued();
    vm.transport.callerAudio(2000, 8000);
    vm.transport.callerHangup();
    const outcome = await vm.session.done;

    expect(outcome).toMatchObject({ status: "completed", cause: "caller_hangup", left: false, recordedSeconds: 0, file: null });
    expect(vm.transport.closes).toBe(1);
    await expect(readFile(recordingPath(vm.dir, vm.organizationId, vm.callId))).rejects.toThrow();
    expect((await notificationsOf(app, vm.organizationId))[0]?.body).toMatch(/não deixou recado/);
    await vm.cleanup();
  });

  it("gravador que não abre encerra a chamada com o motivo, sem tocar o aviso nem deixar ninguém pendurado", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-voicemail-"));
    // A pasta das gravações é um arquivo: o gravador não tem onde escrever.
    const blocked = path.join(dir, "nao-e-pasta");
    await writeFile(blocked, "x");
    const vm = await voicemail("voicemail-broken-disk", { dir: blocked });
    const outcome = await vm.session.done;

    expect(outcome).toMatchObject({ status: "failed", endReason: "voicemail_failed", cause: "record_failed", left: false, file: null });
    expect(vm.transport.played).toEqual([]);
    expect(vm.transport.hangups).toBe(1);
    expect(await callOf(vm.callId)).toMatchObject({ status: "failed", end_reason: "voicemail_failed" });
    const events = await eventsOf(app, vm.callId);
    expect(events.map((event) => event.kind)).toEqual(["call_started", "voicemail_failed", "call_ended", "task_queued"]);
    expect(events[1]?.payload).toMatchObject({ reason: "unavailable" });
    expect((await notificationsOf(app, vm.organizationId))[0]?.body).toMatch(/não pôde ser gravado/);
    await rm(dir, { recursive: true, force: true });
  });

  it("silêncio até o teto não vira recado: nenhum arquivo, e a linha do tempo diz que ninguém falou", async () => {
    const vm = await voicemail("voicemail-silent", { reason: "agent_disabled", maxSeconds: 30 });
    await vm.noticeQueued();
    await vm.noticePlays();
    vm.transport.callerAudio(2000);
    vm.time.advance(30_000);
    const outcome = await vm.session.done;

    expect(outcome).toMatchObject({ status: "completed", endReason: "voicemail", cause: "max_duration", left: false, file: null });
    const events = await eventsOf(app, vm.callId);
    expect(events[1]?.payload).toMatchObject({ left: false, recorded: false, file: null, reason: "agent_disabled" });
    await expect(readFile(recordingPath(vm.dir, vm.organizationId, vm.callId))).rejects.toThrow();
    await vm.cleanup();
  });

  it("quem liga desliga no meio do recado: o que foi falado depois do aviso fica guardado", async () => {
    const vm = await voicemail("voicemail-hangup");
    await vm.noticeQueued();
    await vm.noticePlays();
    vm.transport.callerAudio(900, 8000);
    vm.transport.callerHangup();
    const outcome = await vm.session.done;

    expect(outcome).toMatchObject({ status: "completed", endReason: "voicemail", cause: "caller_hangup", left: true });
    // Quem ligou já saiu: a telefonia é solta sem esperar fala nenhuma.
    expect(vm.transport.closes).toBe(1);
    expect(vm.transport.hangups).toBe(0);
    const { caller } = channelsOf(await readFile(recordingPath(vm.dir, vm.organizationId, vm.callId)));
    expect(caller.filter((sample) => sample !== 0)).toHaveLength(900 * 8);
    await vm.cleanup();
  });
});
