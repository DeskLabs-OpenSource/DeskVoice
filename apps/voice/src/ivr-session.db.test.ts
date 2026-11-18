// A URA (menu por teclas, #223), a máquina de estados sobre um transporte falso e o banco de verdade:
// as ações (T2, T3), o tempo e a tecla inválida (T4), a privacidade da tecla (T5) e cada linha da
// tabela de falhas do desenho (T6). O caminho inteiro, com o AudioSocket, fica em `ivr.db.test.ts`.
import { randomUUID } from "node:crypto";
import { loadIvrMenu, withOrg, withSystem, type IvrMenu } from "@deskvoice/core";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf } from "../../../packages/tools/test/helpers";
import { ivrNotice, startIvrSession, type IvrDeps, type IvrNoticeKind } from "./ivr-session";
import type { Logger } from "./log";
import { callOf, createAgent, createOrganization, eventsOf, fakeClock, testSchedule } from "./testing/db";
import { createIvrMenu, keypadFake, promptTone, type KeypadFake, type MenuOptions } from "./testing/ivr";
import { waitFor } from "./testing/helpers";
import { failureTone, type CallTransport } from "./transport";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const PERSON = "+5531988887777";
const OTHER_PERSON = "+5531977776666";

async function ringingCall(organizationId: string): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into calls (id, organization_id, direction, channel, from_e164, to_e164, status, started_at) values ($1, $2, 'inbound', 'phone', '+5531999998888', '+553133334444', 'ringing', now())", [id, organizationId]),
  );
  return id;
}

interface Harness {
  organizationId: string;
  callId: string;
  menu: IvrMenu;
  transport: KeypadFake;
  timers: ReturnType<typeof testSchedule>;
  logs: string[];
  handedOff: Array<{ agentId: string; transport: CallTransport }>;
  session: ReturnType<typeof startIvrSession>;
}

/** Uma organização, o menu, uma chamada tocando e a URA atendendo. `options` recebe o id de um agente ligado. */
async function answer(label: string, build: (agents: { on: string; off: string }) => MenuOptions, options: Partial<IvrDeps> & { hold?: boolean; rig?: (transport: KeypadFake, menu: IvrMenu) => void } = {}): Promise<Harness> {
  const { hold, rig, ...extra } = options;
  const organizationId = await createOrganization(app, label);
  const agents = { on: await createAgent(app, organizationId), off: await createAgent(app, organizationId, { enabled: false }) };
  const menuId = await createIvrMenu(app, organizationId, build(agents));
  const menu = await withOrg(app, organizationId, (q) => loadIvrMenu(q, menuId));
  if (!menu) throw new Error("menu not found");
  const callId = await ringingCall(organizationId);
  const transport = keypadFake();
  transport.holdPlayback = hold ?? false;
  rig?.(transport, menu);
  const timers = testSchedule();
  const logs: string[] = [];
  const log: Logger = (level, message, fields) => void logs.push(JSON.stringify({ level, message, ...fields }));
  const handedOff: Harness["handedOff"] = [];
  let monotonic = 0;
  const session = startIvrSession(
    { db: app, clock: fakeClock(), schedule: timers.schedule, now: () => (monotonic += 1000), log, startAgent: (agentId, keypad) => void handedOff.push({ agentId, transport: keypad }), ...extra },
    { organizationId, callId, menu, transport },
  );
  await waitFor(async () => (await eventsOf(app, callId)).some((event) => event.kind === "ivr_started"), "ivr_started");
  return { organizationId, callId, menu, transport, timers, logs, handedOff, session };
}

/** Espera o anúncio da tentativa `n` sair e a espera pela tecla ser armada. */
const promptPlayed = async (h: Harness, n: number): Promise<void> => {
  await waitFor(() => h.transport.sent.length >= n, `prompt ${n}`);
  await waitFor(() => h.timers.held().includes(h.menu.timeoutMs), `the wait after prompt ${n}`);
};

const kinds = async (callId: string): Promise<string[]> => (await eventsOf(app, callId)).map((event) => event.kind);
const sameAudio = (a: Buffer | undefined, b: Buffer): boolean => a !== undefined && a.equals(b);

const STANDARD = (agents: { on: string; off: string }): MenuOptions => ({
  options: [
    { digit: "1", label: "Recepção", action: "agent", agentId: agents.on },
    { digit: "2", label: "Financeiro", action: "transfer", transferE164: PERSON },
    { digit: "9", label: "Sair", action: "hangup" },
  ],
});

describe("URA: as ações", { timeout: 60_000 }, () => {
  it("T2: a opção `agent` grava o agente na chamada e passa o mesmo transporte à conversa; depois, a tecla e o desligar não são mais da URA", async () => {
    const h = await answer("ivr-agent", STANDARD);
    await promptPlayed(h, 1);
    expect(await callOf(app, h.callId)).toMatchObject({ status: "in_progress" });
    h.transport.press("1");
    const outcome = await h.session.done;
    expect(outcome).toEqual({ result: "agent", endReason: null });
    expect(h.handedOff).toHaveLength(1);
    expect(h.handedOff[0]?.transport).toBe(h.transport);
    const agentId = h.handedOff[0]?.agentId;
    expect((await callOf(app, h.callId)).agent_id).toBe(agentId);
    expect(await eventsOf(app, h.callId)).toEqual([
      { kind: "ivr_started", payload: { menu_id: h.menu.id } },
      { kind: "ivr_option_chosen", payload: { digit: "1", label: "Recepção", action: "agent", elapsed_ms: expect.any(Number) } },
    ]);

    // Depois da passagem: a tecla não chega à URA, e o desligar dela não encerra nada.
    const before = await eventsOf(app, h.callId);
    h.transport.press("2");
    h.transport.press("9");
    h.transport.callerHangup();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await eventsOf(app, h.callId)).toEqual(before);
    expect(await callOf(app, h.callId)).toMatchObject({ status: "in_progress", ended_at: null });
    expect(h.transport).toMatchObject({ hangups: 0, closes: 0, transferredTo: null });
  });

  it("o áudio de quem ouve o menu é descartado: a conversa que assume não recebe nada de antes da passagem", async () => {
    const heardByAgent: Buffer[] = [];
    const h = await answer("ivr-audio-dropped", STANDARD, {
      startAgent: (_agentId, keypad) => keypad.onAudio((pcm) => void heardByAgent.push(pcm)),
    });
    await promptPlayed(h, 1);
    const during = Buffer.alloc(320, 1);
    h.transport.hear(during);
    h.transport.hear(during);
    h.transport.press("1");
    expect(await h.session.done).toEqual({ result: "agent", endReason: null });
    expect(heardByAgent).toEqual([]);
    // O que chega depois da passagem é da conversa.
    const after = Buffer.alloc(320, 2);
    h.transport.hear(after);
    expect(heardByAgent).toEqual([after]);
  });

  it("T3: a opção `transfer` transfere para o número dela, e `hangup` desliga", async () => {
    const transfer = await answer("ivr-transfer", STANDARD);
    await promptPlayed(transfer, 1);
    transfer.transport.press("2");
    expect(await transfer.session.done).toEqual({ result: "transfer", endReason: "transferred" });
    expect(transfer.transport).toMatchObject({ transferredTo: PERSON, hangups: 0 });
    expect(await callOf(app, transfer.callId)).toMatchObject({ status: "transferred", end_reason: "transferred", ended_at: expect.any(Date) });
    expect(await kinds(transfer.callId)).toEqual(["ivr_started", "ivr_option_chosen", "transfer_started", "call_ended", "task_queued", "task_queued"]);
    expect((await eventsOf(app, transfer.callId)).find((event) => event.kind === "transfer_started")?.payload).toEqual({ to: PERSON, reason: "ivr" });

    const hangup = await answer("ivr-hangup", STANDARD);
    await promptPlayed(hangup, 1);
    hangup.transport.press("9");
    expect(await hangup.session.done).toEqual({ result: "hangup", endReason: "ivr_hangup" });
    expect(hangup.transport).toMatchObject({ transferredTo: null, hangups: 1 });
    expect(await callOf(app, hangup.callId)).toMatchObject({ status: "completed", end_reason: "ivr_hangup" });
    expect((await eventsOf(app, hangup.callId)).filter((event) => event.kind.startsWith("ivr_"))).toEqual([
      { kind: "ivr_started", payload: { menu_id: hangup.menu.id } },
      { kind: "ivr_option_chosen", payload: { digit: "9", label: "Sair", action: "hangup", elapsed_ms: expect.any(Number) } },
      { kind: "ivr_ended", payload: { reason: "option_hangup" } },
    ]);
  });

  it("a tecla no meio do anúncio corta o que falta tocar e vale como escolha", async () => {
    const h = await answer("ivr-barge", STANDARD, { hold: true });
    await waitFor(() => h.transport.sent.length === 1, "the prompt");
    expect(h.timers.held()).not.toContain(h.menu.timeoutMs);
    h.transport.press("2");
    await h.session.done;
    expect(h.transport.cleared).toBe(1);
    expect(h.transport.transferredTo).toBe(PERSON);
  });

  it("quem ligou desliga no meio do menu: a chamada termina por `caller_hangup`, sem tocar nada", async () => {
    const h = await answer("ivr-caller-gone", STANDARD);
    await promptPlayed(h, 1);
    h.transport.callerHangup();
    expect(await h.session.done).toEqual({ result: "caller_hangup", endReason: "caller_hangup" });
    expect(h.transport).toMatchObject({ closes: 1, hangups: 0, transferredTo: null });
    expect(await callOf(app, h.callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup" });
    expect((await eventsOf(app, h.callId)).find((event) => event.kind === "ivr_ended")?.payload).toEqual({ reason: "caller_hangup" });
  });
});

describe("URA: sem escolha (T4)", { timeout: 60_000 }, () => {
  it("o tempo acaba em cada tentativa, o anúncio repete até `max_attempts`, e `person` vai à primeira pessoa pela ordem do teclado", async () => {
    const h = await answer("ivr-timeout-person", () => ({
      maxAttempts: 3,
      onNoChoice: "person",
      // O `0` vem depois do `9` no teclado, embora venha antes na tabela ASCII.
      options: [
        { digit: "0", label: "Telefonista", action: "transfer", transferE164: OTHER_PERSON },
        { digit: "9", label: "Plantão", action: "transfer", transferE164: PERSON },
      ],
    }));
    for (const n of [1, 2, 3]) {
      await promptPlayed(h, n);
      expect(h.timers.fire(h.menu.timeoutMs)).toBe(1);
    }
    expect(await h.session.done).toEqual({ result: "no_choice", endReason: "transferred" });
    expect(h.transport.sent).toHaveLength(3);
    for (const sent of h.transport.sent) expect(sameAudio(sent, h.menu.promptAudio ?? Buffer.alloc(0))).toBe(true);
    expect(h.transport.transferredTo).toBe(PERSON);
    expect((await eventsOf(app, h.callId)).filter((event) => event.kind.startsWith("ivr_"))).toEqual([
      { kind: "ivr_started", payload: { menu_id: h.menu.id } },
      { kind: "ivr_no_choice", payload: { attempt: 1, kind: "timeout" } },
      { kind: "ivr_no_choice", payload: { attempt: 2, kind: "timeout" } },
      { kind: "ivr_no_choice", payload: { attempt: 3, kind: "timeout" } },
      { kind: "ivr_ended", payload: { reason: "no_choice", then: "person" } },
    ]);
  });

  it("tecla que não é opção conta como tentativa, e `hangup` toca a fala \"sem escolha\" no idioma do menu e desliga", async () => {
    const h = await answer("ivr-invalid-hangup", (agents) => ({ ...STANDARD(agents), language: "en", maxAttempts: 2, onNoChoice: "hangup" }));
    await promptPlayed(h, 1);
    h.transport.press("5");
    await promptPlayed(h, 2);
    h.transport.press("7");
    expect(await h.session.done).toEqual({ result: "no_choice", endReason: "ivr_no_choice" });
    expect(h.transport.sent).toHaveLength(3);
    expect(sameAudio(h.transport.sent[2], await ivrNotice("en", "no-choice"))).toBe(true);
    expect(h.transport).toMatchObject({ hangups: 1, transferredTo: null });
    expect(await callOf(app, h.callId)).toMatchObject({ status: "completed", end_reason: "ivr_no_choice" });
    expect((await eventsOf(app, h.callId)).filter((event) => event.kind.startsWith("ivr_"))).toEqual([
      { kind: "ivr_started", payload: { menu_id: h.menu.id } },
      { kind: "ivr_no_choice", payload: { attempt: 1, kind: "invalid" } },
      { kind: "ivr_no_choice", payload: { attempt: 2, kind: "invalid" } },
      { kind: "ivr_ended", payload: { reason: "no_choice", then: "hangup" } },
    ]);
  });
});

/** Todo texto que um evento ou um log carrega, para procurar tecla nele. */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) stringsIn([key, item], out);
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /[0-9*#]/;

/**
 * A lista do que a URA pode escrever no log: cada mensagem é um texto fixo (sem nada interpolado), e
 * cada campo, um destes nomes. Mensagem nova ou campo novo derruba o T5 até entrar aqui de propósito.
 */
const IVR_LOG_MESSAGES = new Set([
  "ivr started",
  "ivr ended",
  "ivr handed the call to the agent",
  "could not read the recorded ivr notice; playing the failure tone",
  "could not record the start of the ivr",
  "could not record an ivr event",
  "could not record the end of the ivr",
  "could not release the telephony side of the ivr",
  "could not hand the call to the agent",
  "ivr session failed",
]);
const IVR_LOG_FIELDS = new Set(["level", "message", "callId", "menuId", "agentId", "options", "result", "endReason", "kind", "language", "error"]);

/**
 * A lista do que um evento da chamada pode levar, em qualquer `kind`: os nomes de campo e os valores
 * de texto fixos. Fora estes, um texto só pode ser uuid, o número de destino do menu ou o rótulo da
 * opção; `digit` só existe em `ivr_option_chosen`.
 */
const EVENT_FIELDS = new Set(["menu_id", "digit", "label", "action", "elapsed_ms", "attempt", "kind", "reason", "then", "to", "status", "costCents", "seconds", "taskId"]);
const EVENT_NUMBERS = new Set(["elapsed_ms", "attempt", "costCents", "seconds"]);
const EVENT_WORDS = new Set([
  // ação da opção e desfecho da URA
  "agent", "transfer", "hangup", "timeout", "invalid", "no_choice", "person", "caller_hangup", "option_hangup", "stopped",
  "prompt_unreadable", "no_person_exit", "agent_disabled", "ivr",
  // status e motivo do fim da chamada
  "transferred", "completed", "failed", "ivr_failed", "ivr_no_choice", "ivr_hangup", "internal_error",
  // tarefas da fila
  "summarize_call", "review_call",
]);

/** O que há de errado no payload de um evento, pela lista do permitido. Vazio: nada. */
function eventOutsideAllowList(kind: string, payload: Record<string, unknown>, allowed: { to: string; label: string; chosen: string | null }): string[] {
  const wrong: string[] = [];
  for (const [field, value] of Object.entries(payload)) {
    if (!EVENT_FIELDS.has(field)) wrong.push(`field ${field}`);
    else if (field === "digit") {
      if (kind !== "ivr_option_chosen" || value !== allowed.chosen) wrong.push(`digit ${JSON.stringify(value)}`);
    } else if (EVENT_NUMBERS.has(field)) {
      if (typeof value !== "number") wrong.push(`${field} ${JSON.stringify(value)}`);
    } else if (typeof value !== "string") wrong.push(`${field} ${JSON.stringify(value)}`);
    else if (!(UUID.test(value) || value === allowed.to || value === allowed.label || EVENT_WORDS.has(value))) wrong.push(`${field} ${JSON.stringify(value)}`);
  }
  return wrong;
}

/** O que há de errado numa linha de log, pela lista do permitido. Vazio: nada. */
function logOutsideAllowList(line: Record<string, unknown>, optionCount: number): string[] {
  const wrong: string[] = [];
  if (typeof line.message !== "string" || !IVR_LOG_MESSAGES.has(line.message)) wrong.push(`message ${JSON.stringify(line.message)}`);
  for (const [field, value] of Object.entries(line)) {
    if (!IVR_LOG_FIELDS.has(field)) wrong.push(`field ${field}`);
    else if (field === "options") {
      if (value !== optionCount) wrong.push(`options ${JSON.stringify(value)}`);
    } else if (typeof value !== "string") wrong.push(`${field} ${JSON.stringify(value)}`);
    else if (!UUID.test(value) && KEY.test(value)) wrong.push(`${field} ${JSON.stringify(value)}`);
  }
  return wrong;
}

describe("URA: a tecla de quem liga não fica guardada (T5)", { timeout: 60_000 }, () => {
  const TYPED = "12345678909#";
  const LABEL = "Atendimento";

  for (const variant of [
    { name: "nenhuma tecla é opção", option: "*", chosen: null },
    { name: "uma tecla é opção", option: "5", chosen: "5" },
  ] as const) {
    it(`quem liga digita ${TYPED} (${variant.name}): eventos, logs e transcrição só levam o que está na lista do permitido`, async () => {
      const h = await answer(`ivr-privacy-${variant.option}`, () => ({
        maxAttempts: 5,
        onNoChoice: "person",
        options: [{ digit: variant.option, label: LABEL, action: "transfer", transferE164: PERSON }],
      }));
      await promptPlayed(h, 1);
      for (const digit of TYPED) {
        h.transport.press(digit);
        // Cada tecla inválida grava a tentativa e toca o anúncio de novo; a próxima tecla chega nele.
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      await h.session.done;

      // Os eventos da chamada inteira, não só os da URA.
      const events = await eventsOf(app, h.callId);
      expect(events.map((event) => event.kind)).toContain("call_ended");
      for (const event of events) {
        expect(eventOutsideAllowList(event.kind, event.payload, { to: PERSON, label: LABEL, chosen: variant.chosen }), `${event.kind} ${JSON.stringify(event.payload)}`).toEqual([]);
        expect(stringsIn(event.payload).join(" "), event.kind).not.toContain(TYPED.slice(0, 11));
      }
      expect(events.filter((event) => event.kind === "ivr_option_chosen").map((event) => event.payload.digit)).toEqual(variant.chosen ? [variant.chosen] : []);
      // `attempt` é a contagem das tentativas, em ordem, e nada além dela.
      const attempts = events.filter((event) => event.kind === "ivr_no_choice").map((event) => event.payload.attempt);
      expect(attempts).toEqual(attempts.map((_, index) => index + 1));
      expect(events.filter((event) => event.kind.startsWith("transcript_"))).toEqual([]);
      expect(await notificationsOf(app, h.organizationId)).toEqual([]);

      expect(h.logs.length).toBeGreaterThan(0);
      for (const line of h.logs) {
        expect(logOutsideAllowList(JSON.parse(line) as Record<string, unknown>, h.menu.options.length), line).toEqual([]);
        expect(line).not.toContain(TYPED.slice(0, 11));
      }
    });
  }
});

describe("URA: toda falha tem uma fala e um evento (T6)", { timeout: 60_000 }, () => {
  const failedSpeech = (language: "pt-BR" | "en" | "es" = "pt-BR") => ivrNotice(language, "failed");

  it("anúncio ausente na hora: a fala `failed`, a pessoa, `ivr_failed { prompt_unreadable }` e o aviso no painel", async () => {
    const h = await answer("ivr-no-prompt", (agents) => ({ ...STANDARD(agents), prompt: null }));
    expect(await h.session.done).toEqual({ result: "failed", endReason: "ivr_failed" });
    expect(h.transport.sent).toHaveLength(1);
    expect(sameAudio(h.transport.sent[0], await failedSpeech())).toBe(true);
    expect(h.transport.transferredTo).toBe(PERSON);
    expect(await callOf(app, h.callId)).toMatchObject({ status: "transferred", end_reason: "ivr_failed" });
    expect((await eventsOf(app, h.callId)).find((event) => event.kind === "ivr_failed")?.payload).toEqual({ reason: "prompt_unreadable" });
    expect(await notificationsOf(app, h.organizationId)).toMatchObject([{ call_id: h.callId, body: expect.stringContaining("o anúncio não pôde ser tocado") }]);
  });

  it("anúncio ilegível (bytes ímpares): o mesmo caminho", async () => {
    const h = await answer("ivr-odd-prompt", (agents) => ({ ...STANDARD(agents), prompt: Buffer.alloc(3) }));
    await h.session.done;
    expect((await eventsOf(app, h.callId)).find((event) => event.kind === "ivr_failed")?.payload).toEqual({ reason: "prompt_unreadable" });
    expect(h.transport.transferredTo).toBe(PERSON);
  });

  it("menu sem opção `transfer` na hora: a fala `failed`, desliga, `ivr_failed { no_person_exit }` e o aviso", async () => {
    const h = await answer("ivr-no-person", (agents) => ({ language: "es", options: [{ digit: "1", label: "Recepción", action: "agent", agentId: agents.on }] }));
    expect(await h.session.done).toEqual({ result: "failed", endReason: "ivr_failed" });
    expect(sameAudio(h.transport.sent[0], await failedSpeech("es"))).toBe(true);
    expect(h.transport).toMatchObject({ hangups: 1, transferredTo: null });
    expect(h.handedOff).toEqual([]);
    expect(await callOf(app, h.callId)).toMatchObject({ status: "failed", end_reason: "ivr_failed" });
    expect((await eventsOf(app, h.callId)).find((event) => event.kind === "ivr_failed")?.payload).toEqual({ reason: "no_person_exit" });
    expect(await notificationsOf(app, h.organizationId)).toMatchObject([{ body: expect.stringContaining("não tem nenhuma opção que leve a uma pessoa") }]);
  });

  it("agente da opção desligado na hora da escolha: a fala `failed`, a pessoa e `ivr_failed { agent_disabled }`", async () => {
    const h = await answer("ivr-agent-off", (agents) => ({
      options: [
        { digit: "1", label: "Recepção", action: "agent", agentId: agents.off },
        { digit: "2", label: "Financeiro", action: "transfer", transferE164: PERSON },
      ],
    }));
    await promptPlayed(h, 1);
    h.transport.press("1");
    expect(await h.session.done).toEqual({ result: "failed", endReason: "ivr_failed" });
    expect(h.handedOff).toEqual([]);
    expect(sameAudio(h.transport.sent.at(-1), await failedSpeech())).toBe(true);
    expect(h.transport.transferredTo).toBe(PERSON);
    expect(await callOf(app, h.callId)).toMatchObject({ status: "transferred", end_reason: "ivr_failed", agent_id: null });
    expect((await eventsOf(app, h.callId)).filter((event) => event.kind.startsWith("ivr_")).map((event) => [event.kind, event.payload])).toEqual([
      ["ivr_started", { menu_id: h.menu.id }],
      ["ivr_option_chosen", { digit: "1", label: "Recepção", action: "agent", elapsed_ms: expect.any(Number) }],
      ["ivr_failed", { reason: "agent_disabled" }],
    ]);
  });

  it("a fala de falha que não se lê: os três bipes, o mesmo evento e `log error`", async () => {
    const unreadable = async (_language: string, _kind: IvrNoticeKind): Promise<Buffer> => {
      throw new Error("the file is gone");
    };
    const h = await answer("ivr-no-speech", (agents) => ({ ...STANDARD(agents), prompt: null }), { notice: unreadable });
    await h.session.done;
    expect(sameAudio(h.transport.sent[0], failureTone())).toBe(true);
    expect((await eventsOf(app, h.callId)).find((event) => event.kind === "ivr_failed")?.payload).toEqual({ reason: "prompt_unreadable" });
    expect(h.logs.some((line) => line.includes('"level":"error"') && line.includes("could not read the recorded ivr notice"))).toBe(true);
  });

  it("as seis falas gravadas existem e se leem", async () => {
    for (const language of ["pt-BR", "en", "es"] as const) {
      for (const kind of ["no-choice", "failed"] as const) {
        const pcm = await ivrNotice(language, kind);
        // Mais de 1 s e menos de 10 s de fala.
        expect(pcm.length, `${language}/${kind}`).toBeGreaterThan(16_000);
        expect(pcm.length, `${language}/${kind}`).toBeLessThan(160_000);
      }
    }
    expect(promptTone().length).toBe(16_000);
  });
});

/** O `sendAudio` da vez `n` lança; os outros saem normalmente. `before` roda antes de lançar. */
const failingSend =
  (n: number, before: (menu: IvrMenu) => void = () => undefined) =>
  (transport: KeypadFake, menu: IvrMenu): void => {
    const send = transport.sendAudio;
    let calls = 0;
    transport.sendAudio = (pcm) => {
      calls += 1;
      if (calls === n) {
        before(menu);
        throw new Error("the audio socket is gone");
      }
      send(pcm);
    };
  };

describe("URA: o erro inesperado também vai à pessoa (DESA-181)", { timeout: 60_000 }, () => {
  const unhandled: unknown[] = [];
  const listen = (reason: unknown): void => void unhandled.push(reason);
  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", listen);
  });
  afterEach(async () => {
    // U6: nenhuma rejeição sem tratamento em nenhum dos caminhos.
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off("unhandledRejection", listen);
    expect(unhandled).toEqual([]);
  });

  /** O desfecho comum: a fala `failed`, a pessoa, `ivr_failed { unexpected }` e o log sem tecla. */
  const wentToPerson = async (h: Harness, digits: string[] = []): Promise<void> => {
    expect(await h.session.done).toEqual({ result: "failed", endReason: "ivr_failed" });
    expect(sameAudio(h.transport.sent.at(-1), await ivrNotice("pt-BR", "failed"))).toBe(true);
    expect(h.transport).toMatchObject({ transferredTo: PERSON, hangups: 0 });
    expect(await callOf(app, h.callId)).toMatchObject({ status: "transferred", end_reason: "ivr_failed" });
    const events = await eventsOf(app, h.callId);
    expect(events.filter((event) => event.kind === "ivr_failed").map((event) => event.payload)).toEqual([{ reason: "unexpected" }]);
    expect(events.find((event) => event.kind === "transfer_started")?.payload).toEqual({ to: PERSON, reason: "ivr" });
    expect(await notificationsOf(app, h.organizationId)).toEqual([]);
    const failure = h.logs.filter((line) => line.includes('"level":"error"') && line.includes("ivr session failed"));
    expect(failure).toHaveLength(1);
    expect(failure[0]).toContain("the audio socket is gone");
    // Nenhuma tecla no log do erro: só a chamada, o menu e a mensagem.
    expect(Object.keys(JSON.parse(failure[0] ?? "{}")).sort()).toEqual(["callId", "error", "level", "menuId", "message"]);
    for (const digit of digits) expect(JSON.parse(failure[0] ?? "{}").error).not.toContain(digit);
  };

  it("U1: o 1º anúncio não sai (`sendAudio` lança): a fala `failed` e a pessoa", async () => {
    const h = await answer("ivr-u1", STANDARD, { rig: failingSend(1) });
    await wentToPerson(h);
    expect(h.transport.sent).toHaveLength(1);
  });

  it("U2: a repetição depois do tempo acabar não sai: o mesmo desfecho, e a ligação não fica muda", async () => {
    const h = await answer("ivr-u2", STANDARD, { rig: failingSend(2) });
    await promptPlayed(h, 1);
    expect(h.timers.fire(h.menu.timeoutMs)).toBe(1);
    await wentToPerson(h);
    expect(await kinds(h.callId)).toContain("ivr_no_choice");
  });

  it("U3: a repetição depois de uma tecla que não é opção não sai: o mesmo desfecho", async () => {
    const h = await answer("ivr-u3", STANDARD, { rig: failingSend(2) });
    await promptPlayed(h, 1);
    h.transport.press("7");
    await wentToPerson(h, ["7"]);
    expect((await eventsOf(app, h.callId)).find((event) => event.kind === "ivr_no_choice")?.payload).toEqual({ attempt: 1, kind: "invalid" });
  });

  it("U4: a conversa não abre (`startAgent` lança): o mesmo desfecho, e `done` resolve `failed`, não `agent`", async () => {
    const h = await answer("ivr-u4", STANDARD, {
      startAgent: () => {
        throw new Error("the audio socket is gone");
      },
    });
    await promptPlayed(h, 1);
    h.transport.press("1");
    await wentToPerson(h, ["1"]);
    expect((await eventsOf(app, h.callId)).filter((event) => event.kind.startsWith("ivr_")).map((event) => event.kind)).toEqual(["ivr_started", "ivr_option_chosen", "ivr_failed"]);
  });

  it("U5: o erro inesperado num menu que ficou sem pessoa: a fala `failed`, desliga e `ivr_failed { unexpected }`", async () => {
    const dropPeople = (menu: IvrMenu): void => {
      menu.options = menu.options.filter((option) => option.action !== "transfer");
    };
    const h = await answer("ivr-u5", STANDARD, { rig: failingSend(1, dropPeople) });
    expect(await h.session.done).toEqual({ result: "failed", endReason: "ivr_failed" });
    expect(sameAudio(h.transport.sent.at(-1), await ivrNotice("pt-BR", "failed"))).toBe(true);
    expect(h.transport).toMatchObject({ transferredTo: null, hangups: 1 });
    expect(await callOf(app, h.callId)).toMatchObject({ status: "failed", end_reason: "ivr_failed" });
    expect((await eventsOf(app, h.callId)).filter((event) => event.kind === "ivr_failed").map((event) => event.payload)).toEqual([{ reason: "unexpected" }]);
    expect(await kinds(h.callId)).not.toContain("transfer_started");
  });
});
