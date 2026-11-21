import { createHash } from "node:crypto";
import { encryptSecret, recordEvent, withOrg, withSystem } from "@deskvoice/core";
import { ANALYSIS_SETTING, OUTCOME_SETTING } from "@deskvoice/voice-engine";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createCall, createOrganization, depsFor, eventsOf, fakeFetch, fakeLookup, openTestDbs, putSetting, secretKey, t0, task, tasksOf } from "../../test/helpers";
import classifyCallOutcome from "./classify_call_outcome";
import deliverWebhook, { callReportSchema, enqueueCallReports, reportIdempotencyKey } from "./deliver_webhook";
import summarizeCall from "./summarize_call";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

/** O token do webhook, em claro: o teste procura este texto no corpo que sai. */
const TOKEN = "tok-secreto-do-crm-123";
const URL_CRM = "https://crm.example.com/calls";
const TELEFONE = "+5511987654321";

/** Grava a lista como o painel grava: o token cifrado, e `events` só quando pedido. */
const cadastra = (org: string, hooks: { name: string; events?: string[]; timeoutSeconds?: number }[]): Promise<void> =>
  putSetting(
    app,
    org,
    "webhooks.allowed",
    hooks.map((hook) => ({ url: URL_CRM, token: encryptSecret(TOKEN, secretKey), ...hook })),
  );

/** Uma ligação de entrada terminada, com agente, número de quem ligou e duas falas. */
const ligacao = async (label: string): Promise<{ org: string; callId: string; agentId: string }> => {
  const org = await createOrganization(app, label);
  const callId = await createCall(app, org, t0);
  const agentId = await withSystem(app, async (q) => {
    const row = await q.one<{ id: string }>("insert into agents (organization_id, name, engine) values ($1, 'Recepção', 'openai-realtime') returning id", [org]);
    await q.exec("update calls set agent_id = $2, status = 'completed', end_reason = 'caller_hangup', ended_at = $3, from_e164 = $4 where id = $1", [
      callId,
      row?.id,
      new Date(t0.getTime() + 95_400),
      TELEFONE,
    ]);
    return row?.id as string;
  });
  await withOrg(app, org, async (q) => {
    await recordEvent(q, callId, "transcript_agent", { text: "Boa tarde, aqui é a Clínica Exemplo." }, t0);
    await recordEvent(q, callId, "transcript_user", { text: "Então pode marcar para terça." }, t0);
  });
  return { org, callId, agentId };
};

const entregas = async (org: string) => (await tasksOf(app, org)).filter((row) => row.kind === "deliver_webhook");
const eventos = async (callId: string, kind: string) => (await eventsOf(app, callId)).filter((event) => event.kind === kind).map((event) => event.payload);
const comTentativa = (org: string, callId: string, name: string, attempts: number) => ({ ...task(org, "deliver_webhook", { name, event: "call.report" }, callId), attempts });
const linhaDa = (callId: string) =>
  withSystem(app, (q) => q.one<{ summary: string | null; outcome: string | null; status: string }>("select summary, outcome, status from calls where id = $1", [callId]));

/** A resposta que a OpenAI devolveria para a análise completa (mesma forma do teste da leitura). */
const ANALISE = {
  outcome: "booked",
  confidence: 0.9,
  evidence: "Então pode marcar para terça.",
  criteria: {
    opening: { status: "met", evidence: "Boa tarde, aqui é a Clínica Exemplo." },
    discovery: { status: "partial", evidence: "" },
    objections: { status: "met", evidence: "" },
    accuracy: { status: "met", evidence: "" },
    closing: { status: "missed", evidence: "" },
  },
  temperature: { start: "warm", middle: "warm", end: "hot" },
  objections: [],
  strengths: ["Foi direto ao ponto."],
  weaknesses: [],
  nextStep: "Confirmar a consulta de terça.",
};
const openai = (): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANALISE) } }], usage: { prompt_tokens: 600, completion_tokens: 100 } }), { status: 200 })) as unknown as typeof fetch;

describe("deliver_webhook: o relatório de cada ligação", () => {
  it("ponta a ponta: a ligação termina, o resumo e a análise rodam, e o webhook recebe o relatório esperado, sem segredo e sem telefone", async () => {
    const { org, callId, agentId } = await ligacao("relatorio ponta a ponta");
    await withSystem(app, async (q) => {
      for (const key of [OUTCOME_SETTING, ANALYSIS_SETTING]) await q.exec("insert into settings (organization_id, key, value) values ($1, $2, 'true'::jsonb)", [org, key]);
      await q.exec("insert into settings (organization_id, key, value) values ($1, 'engine.openai-realtime.api_key', to_jsonb($2::text))", [org, encryptSecret("sk-de-teste", secretKey)]);
    });
    await cadastra(org, [{ name: "crm", events: ["call.report"] }, { name: "outro" }]);

    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));
    // Com a leitura ligada, quem enfileira o relatório é ela, depois de ler.
    expect(await entregas(org)).toEqual([]);
    await classifyCallOutcome.run(task(org, "classify_call_outcome", {}, callId), depsFor(app, { fetch: openai(), lookup: fakeLookup() }));
    const fila = await entregas(org);
    expect(fila.map((row) => row.payload)).toEqual([{ name: "crm", event: "call.report" }]);
    expect(await eventos(callId, "task_queued")).toContainEqual({ taskId: fila[0]?.id, kind: "deliver_webhook" });

    const net = fakeFetch(() => new Response("ok", { status: 202 }));
    await deliverWebhook.run({ ...task(org, "deliver_webhook", fila[0]?.payload, callId), id: fila[0]?.id as string }, depsFor(app, { fetch: net.fetch, lookup: fakeLookup() }));

    expect(net.requests).toHaveLength(1);
    const [pedido] = net.requests;
    expect(pedido?.url).toBe(URL_CRM);
    expect(pedido?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "idempotency-key": createHash("sha256").update(`${callId}\ncall.report\ncrm`).digest("hex"),
    });
    const corpo = pedido?.body as Record<string, unknown>;
    expect(callReportSchema.safeParse(corpo).success).toBe(true);
    expect(corpo).toMatchObject({
      event: "call.report",
      callId,
      agentId,
      direction: "inbound",
      startedAt: t0.toISOString(),
      endedAt: new Date(t0.getTime() + 95_400).toISOString(),
      durationSeconds: 95,
      endReason: "caller_hangup",
      outcome: "booked",
    });
    expect(corpo.summary).toEqual((await linhaDa(callId))?.summary);
    expect(corpo.analysis).toMatchObject({ score: 7, nextStep: "Confirmar a consulta de terça.", temperature: { end: "hot" } });
    // Nem o token, nem a chave do motor, nem o telefone de quem ligou saem no corpo.
    const texto = JSON.stringify(corpo);
    for (const proibido of [TOKEN, "sk-de-teste", TELEFONE, "11987654321"]) expect(texto).not.toContain(proibido);
    expect(await eventos(callId, "webhook_delivered")).toEqual([{ name: "crm", event: "call.report", status: 202, attempt: 1 }]);
  });

  it("desligado de fábrica: sem `events`, nada entra na fila, nem pelo resumo nem pela leitura", async () => {
    const { org, callId } = await ligacao("relatorio desligado");
    await cadastra(org, [{ name: "crm" }, { name: "vazio", events: [] }]);
    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));
    await classifyCallOutcome.run(task(org, "classify_call_outcome", {}, callId), depsFor(app));
    expect(await entregas(org)).toEqual([]);

    // Sem lista nenhuma, e com a lista gravada fora da forma, também: e o resumo continua gravado.
    const semLista = await ligacao("relatorio sem lista");
    await summarizeCall.run(task(semLista.org, "summarize_call", {}, semLista.callId), depsFor(app));
    const quebrada = await ligacao("relatorio lista quebrada");
    await putSetting(app, quebrada.org, "webhooks.allowed", { não: "é uma lista" });
    await summarizeCall.run(task(quebrada.org, "summarize_call", {}, quebrada.callId), depsFor(app));
    expect([...(await entregas(semLista.org)), ...(await entregas(quebrada.org))]).toEqual([]);
    expect((await linhaDa(quebrada.callId))?.summary).toContain("Clínica Exemplo");
  });

  it("com a leitura desligada, o resumo enfileira; uma vez por ligação e por webhook, mesmo rodando de novo", async () => {
    const { org, callId } = await ligacao("relatorio uma vez");
    await cadastra(org, [{ name: "crm", events: ["call.report"] }, { name: "bi", events: ["call.report"] }, { name: "fora" }]);

    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));
    // Sem leitura na fila: é o resumo quem enfileira.
    expect((await tasksOf(app, org)).map((row) => row.kind)).toEqual(["deliver_webhook", "deliver_webhook"]);
    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));
    await classifyCallOutcome.run(task(org, "classify_call_outcome", {}, callId), depsFor(app));
    expect((await entregas(org)).map((row) => row.payload)).toEqual([
      { name: "crm", event: "call.report" },
      { name: "bi", event: "call.report" },
    ]);

    // Depois da faxina das tarefas concluídas, o evento de desfecho é a marca.
    await deliverWebhook.run(task(org, "deliver_webhook", { name: "crm", event: "call.report" }, callId), depsFor(app, { fetch: fakeFetch().fetch, lookup: fakeLookup() }));
    await withSystem(app, (q) => q.exec("delete from tasks where organization_id = $1 and kind = 'deliver_webhook' and payload->>'name' = 'crm'", [org]));
    await withOrg(app, org, (q) => enqueueCallReports(q, callId, t0));
    expect((await entregas(org)).map((row) => row.payload)).toEqual([{ name: "bi", event: "call.report" }]);
  });

  it("servidor responde 500: webhook_failed a cada tentativa, a fila tenta de novo, e a ligação e as outras tarefas ficam intactas", async () => {
    const { org, callId } = await ligacao("relatorio 500");
    await cadastra(org, [{ name: "crm", events: ["call.report"] }]);
    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));
    const antes = await linhaDa(callId);
    const outras = (await tasksOf(app, org)).filter((row) => row.kind !== "deliver_webhook");
    const net = fakeFetch(() => new Response("erro", { status: 500 }));
    const deps = depsFor(app, { fetch: net.fetch, lookup: fakeLookup() });

    for (const attempt of [1, 2, 3]) await expect(deliverWebhook.run(comTentativa(org, callId, "crm", attempt), deps)).rejects.toThrow("Webhook crm did not take the call.report: http HTTP 500");

    expect(net.requests).toHaveLength(3);
    // A mesma chave nas três: quem respeita o cabeçalho grava uma vez só.
    expect(new Set(net.requests.map((request) => request.headers["idempotency-key"]))).toEqual(new Set([reportIdempotencyKey(callId, "crm")]));
    expect(await eventos(callId, "webhook_failed")).toEqual([
      { name: "crm", event: "call.report", reason: "http", status: 500, attempt: 1, retrying: true },
      { name: "crm", event: "call.report", reason: "http", status: 500, attempt: 2, retrying: true },
      { name: "crm", event: "call.report", reason: "http", status: 500, attempt: 3, retrying: false },
    ]);
    expect(await eventos(callId, "webhook_delivered")).toEqual([]);
    expect(await linhaDa(callId)).toEqual(antes);
    expect((await tasksOf(app, org)).filter((row) => row.kind !== "deliver_webhook")).toEqual(outras);
  });

  it("sem resposta no prazo do webhook: webhook_failed com timeout, e nova tentativa", async () => {
    const { org, callId } = await ligacao("relatorio sem resposta");
    await cadastra(org, [{ name: "crm", events: ["call.report"], timeoutSeconds: 1 }]);
    const parado: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error), { once: true }));
    await expect(deliverWebhook.run(comTentativa(org, callId, "crm", 1), depsFor(app, { fetch: parado, lookup: fakeLookup() }))).rejects.toThrow("timeout");
    expect(await eventos(callId, "webhook_failed")).toEqual([{ name: "crm", event: "call.report", reason: "timeout", status: null, attempt: 1, retrying: true }]);
  });

  it("endereço que não é público não recebe nada: unreachable", async () => {
    const { org, callId } = await ligacao("relatorio endereco interno");
    await cadastra(org, [{ name: "crm", events: ["call.report"] }]);
    const net = fakeFetch();
    await expect(deliverWebhook.run(comTentativa(org, callId, "crm", 3), depsFor(app, { fetch: net.fetch, lookup: fakeLookup({ "crm.example.com": ["10.0.0.5"] }) }))).rejects.toThrow("unreachable");
    expect(net.requests).toEqual([]);
    expect(await eventos(callId, "webhook_failed")).toEqual([{ name: "crm", event: "call.report", reason: "unreachable", status: null, attempt: 3, retrying: false }]);
  });

  it("o webhook deixou de pedir o relatório, ou saiu da lista, depois de enfileirado: nada sai, sem nova tentativa", async () => {
    const { org, callId } = await ligacao("relatorio desistiu");
    await cadastra(org, [{ name: "crm" }]);
    const net = fakeFetch();
    const deps = depsFor(app, { fetch: net.fetch, lookup: fakeLookup() });
    await deliverWebhook.run(comTentativa(org, callId, "crm", 1), deps);
    await deliverWebhook.run(comTentativa(org, callId, "sumiu", 1), deps);
    expect(net.requests).toEqual([]);
    expect(await eventos(callId, "webhook_failed")).toEqual([
      { name: "crm", event: "call.report", reason: "not_registered", status: null, attempt: 1, retrying: false },
      { name: "sumiu", event: "call.report", reason: "not_registered", status: null, attempt: 1, retrying: false },
    ]);
  });

  it("ligação apagada a pedido do titular: não entra na fila, e a entrega já enfileirada não sai", async () => {
    const { org, callId } = await ligacao("relatorio apagada");
    await cadastra(org, [{ name: "crm", events: ["call.report"] }]);
    await withSystem(app, (q) => q.exec("update calls set erased_at = $2 where id = $1", [callId, t0]));
    await withOrg(app, org, (q) => enqueueCallReports(q, callId, t0));
    expect(await entregas(org)).toEqual([]);

    const net = fakeFetch();
    await deliverWebhook.run(comTentativa(org, callId, "crm", 1), depsFor(app, { fetch: net.fetch, lookup: fakeLookup() }));
    expect(net.requests).toEqual([]);
    expect(await eventos(callId, "webhook_failed")).toEqual([{ name: "crm", event: "call.report", reason: "erased", status: null, attempt: 1, retrying: false }]);
  });

  it("recusa a tarefa sem chamada, com evento desconhecido ou no formato antigo", async () => {
    const { org, callId } = await ligacao("relatorio payload");
    await cadastra(org, [{ name: "crm", events: ["call.report"] }]);
    const deps = depsFor(app, { fetch: fakeFetch().fetch, lookup: fakeLookup() });
    await expect(deliverWebhook.run(task(org, "deliver_webhook", { name: "crm", event: "call.report" }), deps)).rejects.toThrow("needs a task with callId");
    await expect(deliverWebhook.run(task(org, "deliver_webhook", { name: "crm", event: "call.started" }, callId), deps)).rejects.toThrow();
    await expect(deliverWebhook.run(task(org, "deliver_webhook", { name: "crm", payload: { outcome: "completed" } }, callId), deps)).rejects.toThrow();
  });
});
