import { recordEvent, withOrg, withSystem, type CallEventKind } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, openTestDbs, t0, task } from "../../test/helpers";
import summarizeCall, { extractiveSummary } from "./summarize_call";

const { app, owner } = openTestDbs();
let org: string;
beforeAll(async () => {
  org = await createOrganization(app, "summarize");
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

const record = (callId: string, events: [CallEventKind, object][]): Promise<void> =>
  withOrg(app, org, async (q) => {
    for (const [kind, payload] of events) await recordEvent(q, callId, kind, payload, t0);
  });
const summaryOf = async (callId: string): Promise<string | null> => (await withSystem(app, (q) => q.one<{ summary: string | null }>("select summary from calls where id = $1", [callId])))?.summary ?? null;

describe("summarize_call", () => {
  it("grava em calls.summary o desfecho, as falas e as ferramentas usadas", async () => {
    const callId = await createCall(app, org, t0);
    await withSystem(app, (q) => q.exec("update calls set status = 'transferred', end_reason = 'pediu atendente' where id = $1", [callId]));
    await record(callId, [
      ["call_started", {}],
      ["transcript_agent", { text: "Olá! Como posso ajudar?" }],
      ["transcript_user", { text: "Quero falar sobre a minha fatura." }],
      ["tool_called", { name: "notify_human", args: {} }],
      ["tool_called", { name: "transfer_to_human", args: {} }],
      ["tool_called", { name: "notify_human", args: {} }],
      ["tool_result", { name: "transfer_to_human", ok: true }],
    ]);

    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));

    expect(await summaryOf(callId)).toBe(
      [
        "Desfecho: transferida para um humano (pediu atendente).",
        "Conversa:",
        "Agente: Olá! Como posso ajudar?",
        "Cliente: Quero falar sobre a minha fatura.",
        "Ferramentas usadas: notify_human, transfer_to_human.",
      ].join("\n"),
    );
  });

  it("é repetível: rodar de novo dá o mesmo resumo", async () => {
    const callId = await createCall(app, org, t0);
    await record(callId, [["transcript_user", { text: "Alô?" }]]);
    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));
    const first = await summaryOf(callId);
    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));
    expect(await summaryOf(callId)).toBe(first);
  });

  it("falha com mensagem clara sem chamada ou com chamada de outra organização", async () => {
    await expect(summarizeCall.run(task(org, "summarize_call"), depsFor(app))).rejects.toThrow(/needs a task with callId/);
    const other = await createOrganization(app, "summarize other");
    const foreign = await createCall(app, other, t0);
    await expect(summarizeCall.run(task(org, "summarize_call", {}, foreign), depsFor(app))).rejects.toThrow(/not found/);
    expect(await summaryOf(foreign)).toBeNull();
  });
});

describe("extractiveSummary", () => {
  const turns = Array.from({ length: 8 }, (_, index) => ({ speaker: index % 2 === 0 ? ("agent" as const) : ("user" as const), text: `fala ${index + 1}` }));

  it("em conversa longa mostra só as três primeiras e as três últimas falas", () => {
    expect(extractiveSummary({ status: "completed", endReason: null, turns, toolsUsed: [] })).toBe(
      ["Desfecho: concluída.", "Começo da conversa:", "Agente: fala 1", "Cliente: fala 2", "Agente: fala 3", "Fim da conversa (8 falas no total):", "Cliente: fala 6", "Agente: fala 7", "Cliente: fala 8"].join("\n"),
    );
  });

  it("diz quando não há transcrição e corta fala longa", () => {
    expect(extractiveSummary({ status: "failed", endReason: "engine_failed", turns: [], toolsUsed: [] })).toBe("Desfecho: falhou (engine_failed).\nSem falas transcritas.");
    const long = extractiveSummary({ status: "completed", endReason: null, turns: [{ speaker: "user", text: "a".repeat(500) }], toolsUsed: [] });
    expect(long).toContain(`Cliente: ${"a".repeat(200)}…`);
    expect(long).not.toContain("a".repeat(201));
  });
});
