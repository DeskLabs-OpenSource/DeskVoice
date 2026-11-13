import { encryptSecret, recordEvent, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createCall, createOrganization, depsFor, openTestDbs, t0, task } from "../../test/helpers";
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

/** O corpo que a OpenAI devolveria, com `content` já em JSON — é o que o motor lê. */
const openai = (palpite: unknown, status = 200): typeof fetch =>
  vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(palpite) } }] }), { status }),
  ) as unknown as typeof fetch;

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

  it("provedor fora do ar não enterra a ligação como sem desfecho", async () => {
    const { org, callId } = await comAgente("desfecho provedor fora");
    await comChave(org);
    await fala(org, callId, "Alô?");
    const fetch = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof globalThis.fetch;

    await roda(org, callId, fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await desfechoDe(callId))?.outcome).toBeNull();
  });

  it("sem fala transcrita não gasta chamada", async () => {
    const { org, callId } = await comAgente("desfecho sem fala");
    await comChave(org);
    const fetch = openai({ outcome: "booked", confidence: 0.9, evidence: "x" });

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect((await desfechoDe(callId))?.outcome).toBeNull();
  });
});
