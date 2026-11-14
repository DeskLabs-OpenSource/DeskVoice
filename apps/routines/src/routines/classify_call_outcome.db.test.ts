import { encryptSecret, recordEvent, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createCall, createOrganization, depsFor, eventsOf, openTestDbs, t0, task } from "../../test/helpers";
import { OUTCOME_SETTING } from "@deskvoice/voice-engine";
import classifyCallOutcome from "./classify_call_outcome";

const { app, owner } = openTestDbs();
const secretKey = depsFor(app).secretKey;

/** O motor de verdade, com a chamada ao provedor interceptada: o que se prova aqui é a rotina. */
const MOTOR = "openai-realtime";

afterAll(async () => {
  await app.close();
  await owner.close();
});

const comAgente = async (label: string): Promise<{ org: string; callId: string }> => {
  const org = await createOrganization(app, label);
  const agentId = await withSystem(app, async (q) => {
    const row = await q.one<{ id: string }>("insert into agents (organization_id, name, engine) values ($1, $2, $3) returning id", [org, "Recepção", MOTOR]);
    return row?.id as string;
  });
  const callId = await createCall(app, org, t0);
  await withSystem(app, (q) => q.exec("update calls set agent_id = $2 where id = $1", [callId, agentId]));
  return { org, callId };
};

/** A chave do motor e o desfecho ligado: é como fica depois que o dono liga em Configurações. */
const comChave = (org: string, motor = MOTOR): Promise<number> =>
  withSystem(app, async (q) => {
    await q.exec("insert into settings (organization_id, key, value) values ($1, $2, 'true'::jsonb)", [org, OUTCOME_SETTING]);
    return q.exec("insert into settings (organization_id, key, value) values ($1, $2, to_jsonb($3::text))", [org, `engine.${motor}.api_key`, encryptSecret("sk-de-teste", secretKey)]);
  });

const fala = (org: string, callId: string, texto: string): Promise<void> =>
  withOrg(app, org, (q) => recordEvent(q, callId, "transcript_user", { text: texto }, t0));

const desfechoDe = (callId: string) =>
  withSystem(app, (q) =>
    q.one<{ outcome: string | null; outcome_confidence: string | null; outcome_evidence: string | null }>(
      "select outcome, outcome_confidence, outcome_evidence from calls where id = $1",
      [callId],
    ),
  );

/**
 * O consumo que a OpenAI declararia. Grande de propósito, para a conta não sumir no arredondamento:
 * 800 mil de entrada a US$ 0,05, 200 mil em cache a US$ 0,005 e 100 mil de saída a US$ 0,40 por
 * milhão dão 8,1 centavos, que o preço arredonda para 9.
 */
const USO = { prompt_tokens: 1_000_000, completion_tokens: 100_000, prompt_tokens_details: { cached_tokens: 200_000 } };
const CUSTO = 9;

/** O corpo que a OpenAI devolveria, com `content` já em JSON — é o que o motor lê. */
const openai = (palpite: unknown, status = 200): typeof fetch =>
  vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(palpite) } }], usage: USO }), { status }),
  ) as unknown as typeof fetch;

/** O provedor responde um erro com este status e este corpo. */
const erro = (status: number, corpo: unknown = { error: { message: "não importa" } }): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

const custoDe = (callId: string) =>
  withSystem(app, async (q) => ({
    call: (await q.one<{ cost_cents: number }>("select cost_cents from calls where id = $1", [callId]))?.cost_cents,
    extrato: await q.many<{ engine: string; input_tokens: number; output_tokens: number; cost_cents: number }>(
      "select engine, input_tokens, output_tokens, cost_cents from usage_ledger where call_id = $1",
      [callId],
    ),
  }));

const falhasDe = async (callId: string) => (await eventsOf(app, callId)).filter((event) => event.kind === "outcome_not_classified").map((event) => event.payload);

const roda = (org: string, callId: string, fetch: typeof globalThis.fetch) =>
  classifyCallOutcome.run(task(org, "classify_call_outcome", {}, callId), depsFor(app, { fetch }));

describe("classify_call_outcome", () => {
  it("grava o desfecho com a fala que o sustenta", async () => {
    const { org, callId } = await comAgente("desfecho booked");
    await comChave(org);
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");

    await roda(org, callId, openai({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." }));

    const desfecho = await desfechoDe(callId);
    expect(desfecho?.outcome).toBe("booked");
    expect(Number(desfecho?.outcome_confidence)).toBeCloseTo(0.9);
    expect(desfecho?.outcome_evidence).toContain("quinta às dez");
    expect(await falhasDe(callId)).toEqual([]);
  });

  it("soma o que o provedor cobrou ao custo da chamada e ao extrato, pelo preço do modelo de texto", async () => {
    const { org, callId } = await comAgente("desfecho custo");
    await comChave(org);
    await withSystem(app, (q) => q.exec("update calls set cost_cents = 40 where id = $1", [callId]));
    await fala(org, callId, "Me liga amanhã, por favor.");

    await roda(org, callId, openai({ outcome: "callback_requested", confidence: 0.8, evidence: "Me liga amanhã, por favor." }));

    expect(await custoDe(callId)).toEqual({ call: 40 + CUSTO, extrato: [{ engine: MOTOR, input_tokens: 1_000_000, output_tokens: 100_000, cost_cents: CUSTO }] });
  });

  it("no teto de custo do agente não chama o provedor e diz por quê", async () => {
    const { org, callId } = await comAgente("desfecho teto");
    await comChave(org);
    await withSystem(app, (q) => q.exec("update calls set cost_cents = 500 where id = $1", [callId]));
    await fala(org, callId, "Pode marcar quinta às dez.");
    const fetch = openai({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez." });

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect((await desfechoDe(callId))?.outcome).toBeNull();
    expect(await falhasDe(callId)).toEqual([{ reason: "cost_ceiling", engine: MOTOR, costCents: 500, ceilingCents: 500 }]);
    expect((await custoDe(callId)).call).toBe(500);
  });

  it("palpite fraco vira unknown, mas a evidência fica guardada para auditoria", async () => {
    const { org, callId } = await comAgente("desfecho fraco");
    await comChave(org);
    await fala(org, callId, "Ah, tudo bem, obrigado.");

    await roda(org, callId, openai({ outcome: "not_interested", confidence: 0.2, evidence: "tudo bem, obrigado" }));

    const desfecho = await desfechoDe(callId);
    expect(desfecho?.outcome).toBe("unknown");
    expect(Number(desfecho?.outcome_confidence)).toBeCloseTo(0.2);
    expect(desfecho?.outcome_evidence).toContain("obrigado");
  });

  it("desligado (de fábrica) não chama o provedor, mesmo com chave", async () => {
    const { org, callId } = await comAgente("desfecho desligado");
    await withSystem(app, (q) => q.exec("insert into settings (organization_id, key, value) values ($1, $2, to_jsonb($3::text))", [org, `engine.${MOTOR}.api_key`, encryptSecret("sk-de-teste", secretKey)]));
    await fala(org, callId, "Pode marcar quinta às dez.");
    const fetch = openai({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez." });

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect((await desfechoDe(callId))?.outcome).toBeNull();
  });

  it("sem chave salva não chama o provedor e não grava nada", async () => {
    const { org, callId } = await comAgente("desfecho sem chave");
    await withSystem(app, (q) => q.exec("insert into settings (organization_id, key, value) values ($1, $2, 'true'::jsonb)", [org, OUTCOME_SETTING]));
    await fala(org, callId, "Queria um orçamento.");
    const fetch = openai({ outcome: "info_only", confidence: 0.9, evidence: "Queria um orçamento." });

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect((await desfechoDe(callId))?.outcome).toBeNull();
  });

  it("não classifica duas vezes a mesma ligação", async () => {
    const { org, callId } = await comAgente("desfecho repetido");
    await comChave(org);
    await fala(org, callId, "Quero falar com o financeiro.");
    await withSystem(app, (q) => q.exec("update calls set outcome = 'callback_requested' where id = $1", [callId]));
    const fetch = openai({ outcome: "booked", confidence: 0.9, evidence: "x" });

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect((await desfechoDe(callId))?.outcome).toBe("callback_requested");
  });

  it("falha do provedor não enterra a ligação como sem desfecho: vira um evento com o motivo", async () => {
    const casos: Array<[string, typeof globalThis.fetch, Record<string, unknown>]> = [
      ["401", erro(401), { reason: "rejected", status: 401, costCents: 0 }],
      ["modelo inexistente", erro(404, { error: { code: "model_not_found" } }), { reason: "model_unavailable", status: 404, costCents: 0 }],
      ["sem crédito", erro(429, { error: { code: "insufficient_quota" } }), { reason: "no_credit", status: 429, costCents: 0 }],
      ["fora do ar", erro(500), { reason: "unreachable", status: 500, costCents: 0 }],
      ["rede", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof globalThis.fetch, { reason: "unreachable", status: null, costCents: 0 }],
      // Um 200 fora da forma foi cobrado: o custo entra, e o desfecho fica para depois.
      ["fora do schema", openai({ outcome: "comprou", confidence: 2, evidence: "" }), { reason: "unexpected_response", status: 200, costCents: CUSTO }],
    ];
    for (const [nome, fetch, esperado] of casos) {
      const { org, callId } = await comAgente(`desfecho falha ${nome}`);
      await comChave(org);
      await fala(org, callId, "Alô?");

      await roda(org, callId, fetch);

      expect(fetch, nome).toHaveBeenCalledTimes(1);
      expect((await desfechoDe(callId))?.outcome, nome).toBeNull();
      expect(await falhasDe(callId), nome).toEqual([{ engine: MOTOR, model: "gpt-5-nano", ...esperado }]);
      expect((await custoDe(callId)).call, nome).toBe(esperado.costCents);
      // Nem a chave nem o corpo do provedor vão para a linha do tempo.
      expect(JSON.stringify(await eventsOf(app, callId)), nome).not.toContain("sk-de-teste");
    }
  });

  it("sem fala transcrita não gasta chamada", async () => {
    const { org, callId } = await comAgente("desfecho sem fala");
    await comChave(org);
    const fetch = openai({ outcome: "booked", confidence: 0.9, evidence: "x" });

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect((await desfechoDe(callId))?.outcome).toBeNull();
  });

  it("o titular pede o apagamento enquanto o provedor responde: o desfecho e o custo ficam, a citação não", async () => {
    const { org, callId } = await comAgente("desfecho apagado no meio");
    await comChave(org);
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");
    const responde = openai({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." });
    // O apagamento confirma depois de a rotina ler as falas e antes de ela gravar o desfecho.
    const apagaNoMeio = (async (...args: Parameters<typeof fetch>) => {
      await withSystem(app, (q) => q.exec("update calls set erased_at = $2 where id = $1", [callId, t0]));
      return responde(...args);
    }) as typeof fetch;

    await roda(org, callId, apagaNoMeio);

    const desfecho = await desfechoDe(callId);
    expect(desfecho?.outcome).toBe("booked");
    expect(desfecho?.outcome_evidence).toBeNull();
    expect((await custoDe(callId)).call).toBe(CUSTO);
  });
});
