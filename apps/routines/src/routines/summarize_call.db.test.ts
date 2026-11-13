import { recordEvent, withOrg, withSystem, type CallEventKind } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OUTCOME_SETTING } from "@deskvoice/voice-engine";
import { createCall, createOrganization, depsFor, openTestDbs, putSetting, putWhatsAppConnector, t0, task, tasksOf } from "../../test/helpers";
import summarizeCall, { OWNER_NOTICE_BODY, OWNER_NOTICE_SETTING, extractiveSummary } from "./summarize_call";

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

  it("só deixa o desfecho na fila quando o dono ligou a classificação", async () => {
    const desligada = await createOrganization(app, "summarize outcome off");
    const ligada = await createOrganization(app, "summarize outcome on");
    await putSetting(app, ligada, OUTCOME_SETTING, true, false);
    for (const organization of [desligada, ligada]) {
      const callId = await createCall(app, organization, t0);
      await summarizeCall.run(task(organization, "summarize_call", {}, callId), depsFor(app));
    }

    expect((await tasksOf(app, desligada)).map((queued) => queued.kind)).toEqual([]);
    expect((await tasksOf(app, ligada)).map((queued) => queued.kind)).toEqual(["classify_call_outcome"]);
  });

  it("falha com mensagem clara sem chamada ou com chamada de outra organização", async () => {
    await expect(summarizeCall.run(task(org, "summarize_call"), depsFor(app))).rejects.toThrow(/needs a task with callId/);
    const other = await createOrganization(app, "summarize other");
    const foreign = await createCall(app, other, t0);
    await expect(summarizeCall.run(task(org, "summarize_call", {}, foreign), depsFor(app))).rejects.toThrow(/not found/);
    expect(await summaryOf(foreign)).toBeNull();
  });
});

/**
 * O resumo não serve de nada se só quem já abriu o painel o encontra. Estes casos guardam o
 * aviso pelo WhatsApp: nasce desligado, sai com corpo fixo (nada do que foi dito nem o número de
 * quem ligou deixa a instalação) e tem cadeado contra mensagem repetida, porque a fila reexecuta
 * `summarize_call` e o dono não pode receber o mesmo aviso duas vezes.
 */
describe("o dono recebe o aviso de fim de ligação pelo WhatsApp", () => {
  const DONO = "+5511999990000";
  const QUEM_LIGOU = "+5521988887777";
  const ligar = (organizationId: string): Promise<void> => putSetting(app, organizationId, OWNER_NOTICE_SETTING, true, false);
  const recordIn = (organizationId: string, callId: string, events: [CallEventKind, object][]): Promise<void> =>
    withOrg(app, organizationId, async (q) => {
      for (const [kind, payload] of events) await recordEvent(q, callId, kind, payload, t0);
    });
  // `createOrganization` cria a organização sem gente dentro: quem atende é criado aqui,
  // como dono, porque é ele que recebe o resumo. `createUser` do kit cria operador — não serve.
  const dono = (organizationId: string, e164: string | null): Promise<number> =>
    withSystem(app, (q) =>
      q.exec("insert into users (organization_id, email, name, password_hash, role, whatsapp_e164) values ($1, $2, 'Dono', 'x', 'owner', $3)", [
        organizationId,
        `dono-${organizationId}@example.com`,
        e164,
      ]),
    );
  const avisosDe = (organizationId: string): Promise<{ channel: string; target: string | null; body: string }[]> =>
    withSystem(app, (q) =>
      q.many<{ channel: string; target: string | null; body: string }>(
        "select channel, target, body from notifications where organization_id = $1 order by created_at",
        [organizationId],
      ),
    );
  const entregasDe = (organizationId: string): Promise<number> =>
    withSystem(app, async (q) => (await q.many("select id from tasks where organization_id = $1 and kind = 'deliver_notification'", [organizationId])).length);

  it("desligado de fábrica: com conector e número do dono, não cria aviso nem tarefa", async () => {
    const org = await createOrganization(app, "aviso desligado");
    await putWhatsAppConnector(app, org);
    await dono(org, DONO);
    const callId = await createCall(app, org, t0);
    await recordIn(org, callId, [["transcript_user", { text: "Alô?" }]]);

    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));

    expect(await avisosDe(org)).toHaveLength(0);
    expect(await entregasDe(org)).toBe(0);
    expect(await summaryOf(callId)).toContain("Desfecho:");
  });

  it("ligado, com conector e número do dono: um aviso de corpo fixo, sem fala e sem telefone, e uma entrega", async () => {
    const org = await createOrganization(app, "resumo no whatsapp");
    await putWhatsAppConnector(app, org);
    await ligar(org);
    await dono(org, DONO);
    const callId = await createCall(app, org, t0);
    await withSystem(app, (q) => q.exec("update calls set from_e164 = $2 where id = $1", [callId, QUEM_LIGOU]));
    await recordIn(org, callId, [
      ["transcript_agent", { text: "Bom dia!" }],
      ["transcript_user", { text: "Quero um orçamento de 30 caixas." }],
    ]);

    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));

    const avisos = await avisosDe(org);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.channel).toBe("whatsapp");
    expect(avisos[0]?.target).toBe(DONO);
    expect(avisos[0]?.body).toBe(OWNER_NOTICE_BODY);
    expect(avisos[0]?.body).not.toContain("orçamento");
    expect(avisos[0]?.body).not.toContain(QUEM_LIGOU);
    expect(await entregasDe(org)).toBe(1);
  });

  it("a reexecução da tarefa não manda o resumo de novo", async () => {
    const org = await createOrganization(app, "resumo sem repetir");
    await putWhatsAppConnector(app, org);
    await ligar(org);
    await dono(org, DONO);
    const callId = await createCall(app, org, t0);
    await recordIn(org, callId, [["transcript_user", { text: "Alô?" }]]);

    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));
    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));

    expect(await avisosDe(org)).toHaveLength(1);
    expect(await entregasDe(org)).toBe(1);
  });

  it("sem conector configurado o resumo fica só no painel", async () => {
    const org = await createOrganization(app, "resumo sem conector");
    await ligar(org);
    await dono(org, DONO);
    const callId = await createCall(app, org, t0);
    await recordIn(org, callId, [["transcript_user", { text: "Alô?" }]]);

    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));

    expect(await avisosDe(org)).toHaveLength(0);
    expect(await summaryOf(callId)).toContain("Desfecho:");
  });

  it("sem número do dono o resumo fica só no painel", async () => {
    const org = await createOrganization(app, "resumo sem numero");
    await putWhatsAppConnector(app, org);
    await ligar(org);
    await dono(org, null);
    const callId = await createCall(app, org, t0);
    await recordIn(org, callId, [["transcript_user", { text: "Alô?" }]]);

    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));

    expect(await avisosDe(org)).toHaveLength(0);
    expect(await summaryOf(callId)).toContain("Desfecho:");
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
