import { callAnalysisSchema, encryptSecret, recordEvent, scoreOf, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createCall, createOrganization, depsFor, eventsOf, fakeLookup, openTestDbs, t0, task } from "../../test/helpers";
import { ANALYSIS_CRITERIA, ANALYSIS_SETTING, OMITTED_TURNS_MARK, OUTCOME_SETTING, type Brain, type BrainModel, type VoiceEngine } from "@deskvoice/voice-engine";
import type * as VoiceEngineModule from "@deskvoice/voice-engine";
import classifyCallOutcome from "./classify_call_outcome";

/**
 * Um motor a mais no mapa de `loadEngines`, para o caminho que nenhum motor de verdade alcança: a
 * análise passa pelo schema da resposta e cai no de gravação. Os motores de verdade seguem iguais.
 */
const FALSO = vi.hoisted(() => ({ id: "falso-que-analisa", analyzes: true, classifyOutcome: vi.fn() }));
/** Um cérebro a mais no mapa de `loadBrains`, com o pedido interceptado: o consumo é o que o teste disser. */
const CEREBRO = vi.hoisted(() => ({ id: "cerebro-falso", label: "Cérebro falso", keyUrl: "https://exemplo.invalid/chaves", listModels: vi.fn(), completeJson: vi.fn() }));
vi.mock("@deskvoice/voice-engine", async (importOriginal) => {
  const real = await importOriginal<typeof VoiceEngineModule>();
  return {
    ...real,
    loadEngines: async (...args: Parameters<typeof real.loadEngines>) => (await real.loadEngines(...args)).set(FALSO.id, FALSO as unknown as VoiceEngine),
    loadBrains: async (...args: Parameters<typeof real.loadBrains>) => (await real.loadBrains(...args)).set(CEREBRO.id, CEREBRO as unknown as Brain),
  };
});

const { app, owner } = openTestDbs();
const secretKey = depsFor(app).secretKey;

/** O motor de verdade, com a chamada ao provedor interceptada: o que se prova aqui é a rotina. */
const MOTOR = "openai-realtime";

afterAll(async () => {
  await app.close();
  await owner.close();
});

const comAgente = async (label: string, motor = MOTOR): Promise<{ org: string; callId: string }> => {
  const org = await createOrganization(app, label);
  const agentId = await withSystem(app, async (q) => {
    const row = await q.one<{ id: string }>("insert into agents (organization_id, name, engine) values ($1, $2, $3) returning id", [org, "Recepção", motor]);
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
 * milhão dão 8,1 centavos. O extrato guarda os 8,1 inteiros (em micro-centavos) e as vistas em
 * centavo dizem 8; é o mesmo consumo que a fatura cobraria.
 */
const USO = { prompt_tokens: 1_000_000, completion_tokens: 100_000, prompt_tokens_details: { cached_tokens: 200_000 } };
/** Os 8,1 centavos, em centavo inteiro: o que a coluna da linha e o evento dizem. */
const CUSTO = 8;
/** O mesmo valor na unidade do extrato, sem arredondar: 8,1 centavos são 8 100 000 µ¢. */
const CUSTO_MICRO = 8_100_000;
const MICRO = 1_000_000;

/**
 * O consumo de uma leitura de verdade, e não de um milhão de tokens: a transcrição cortada e a
 * resposta curta. Pelo preço do `gpt-5-nano`, dá 0,034 centavo — o valor de tabela que, arredondado
 * para centavo inteiro, virava 1 centavo por classificação (trinta vezes o real).
 */
const USO_CURTO = { prompt_tokens: 6_000, completion_tokens: 100 };
const CUSTO_CURTO = 34_000;

/** O corpo que a OpenAI devolveria, com `content` já em JSON — é o que o motor lê. */
const openai = (palpite: unknown, status = 200, uso: object = USO): typeof fetch =>
  vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(palpite) } }], usage: uso }), { status }),
  ) as unknown as typeof fetch;

interface Pedido {
  url: string;
  model: string;
  authorization: string | null;
}

/**
 * Como `openai`, mas guarda cada pedido que sai: o endereço, o modelo e a chave no cabeçalho. O que
 * se prova aqui é o que a rotina repassa ao motor, e com que chave. `responde` troca a resposta de
 * um endereço (um redirecionamento, por exemplo).
 */
const pedidoCom = (palpite: unknown, responde: (url: string) => Response | undefined = () => undefined): { fetch: typeof fetch; pedidos: Pedido[] } => {
  const pedidos: Pedido[] = [];
  const fetchFalso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    pedidos.push({ url: String(url), model: (JSON.parse(String(init?.body)) as { model: string }).model, authorization: new Headers(init?.headers).get("authorization") });
    return responde(String(url)) ?? new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(palpite) } }], usage: USO }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchFalso as unknown as typeof globalThis.fetch, pedidos };
};

/** A chave do motor, gravada por `comChave`, e a do endpoint, gravada por `comDestino`. */
const CHAVE_DO_MOTOR = "Bearer sk-de-teste";
const CHAVE_DO_ENDPOINT = "sk-do-endpoint";

/** Grava o destino da classificação como o painel faria: endpoint, modelo e a chave do endpoint, cifrada. */
const comDestino = (org: string, valores: { baseUrl?: string; modelo?: string; chave?: string }): Promise<number> =>
  withSystem(app, (q) =>
    q.exec("insert into settings (organization_id, key, value, secret) values ($1, 'engine.openai-realtime.classify_target', $2, true)", [
      org,
      JSON.stringify({
        ...(valores.baseUrl !== undefined && { baseUrl: valores.baseUrl }),
        ...(valores.modelo !== undefined && { model: valores.modelo }),
        ...(valores.chave !== undefined && { apiKey: encryptSecret(valores.chave, secretKey) }),
      }),
    ]),
  );

/** O provedor responde um erro com este status e este corpo. */
const erro = (status: number, corpo: unknown = { error: { message: "não importa" } }): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

const custoDe = (callId: string) =>
  withSystem(app, async (q) => ({
    call: (await q.one<{ cost_cents: number }>("select cost_cents from calls where id = $1", [callId]))?.cost_cents,
    // `cost_microcents` é bigint: o driver devolve texto, e o teste compara número.
    extrato: (
      await q.many<{ engine: string; input_tokens: number; output_tokens: number; cost_cents: number; cost_microcents: string }>(
        "select engine, input_tokens, output_tokens, cost_cents, cost_microcents from usage_ledger where call_id = $1 order by at",
        [callId],
      )
    ).map((linha) => ({ ...linha, cost_microcents: Number(linha.cost_microcents) })),
  }));

/** O que o extrato somou, em micro-centavos: é a unidade em que a fração de centavo existe. */
const microsDe = async (callId: string): Promise<number> =>
  withSystem(app, async (q) => Number((await q.one<{ micros: string }>("select coalesce(sum(cost_microcents), 0) as micros from usage_ledger where call_id = $1", [callId]))?.micros));

const falhasDe = async (callId: string) => (await eventsOf(app, callId)).filter((event) => event.kind === "outcome_not_classified").map((event) => event.payload);

// O DNS é falso: todo nome resolve para um endereço público, e o teste não consulta a rede.
const roda = (org: string, callId: string, fetch: typeof globalThis.fetch) =>
  classifyCallOutcome.run(task(org, "classify_call_outcome", {}, callId), depsFor(app, { fetch, lookup: fakeLookup() }));

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

  it("provedor compatível: o endpoint, o modelo e a chave do endpoint chegam ao pedido; a do motor, nunca", async () => {
    const { org, callId } = await comAgente("desfecho provedor compatível");
    await comChave(org);
    await comDestino(org, { baseUrl: "https://api.deepseek.com/v1", modelo: "deepseek-chat", chave: CHAVE_DO_ENDPOINT });
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");

    const { fetch, pedidos } = pedidoCom({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." });
    await roda(org, callId, fetch);

    expect(pedidos).toEqual([{ url: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat", authorization: `Bearer ${CHAVE_DO_ENDPOINT}` }]);
    expect((await desfechoDe(callId))?.outcome).toBe("booked");
    expect(await falhasDe(callId)).toEqual([]);
  });

  it("endpoint sem a chave dele: nenhum pedido sai, nem com a chave do motor, e a linha do tempo diz por quê", async () => {
    const { org, callId } = await comAgente("desfecho endpoint sem chave");
    await comChave(org);
    await liga(org, ANALYSIS_SETTING);
    await comDestino(org, { baseUrl: "https://api.deepseek.com/v1", modelo: "deepseek-chat" });
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");

    const { fetch, pedidos } = pedidoCom({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." });
    await roda(org, callId, fetch);

    // Nem para o endpoint, nem para a OpenAI: a chave do motor foi dada à OpenAI para a voz, e
    // cair nela aqui a levaria a um endereço que o dono não escolheu para ela.
    expect(pedidos).toEqual([]);
    expect(pedidos.filter((pedido) => pedido.authorization === CHAVE_DO_MOTOR)).toEqual([]);
    expect(await falhasDe(callId)).toEqual([{ reason: "endpoint_key_missing", engine: MOTOR }]);
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([{ reason: "endpoint_key_missing", engine: MOTOR }]);
    expect((await desfechoDe(callId))?.outcome).toBeNull();
  });

  it("com o endpoint e a chave dele, a classificação sai mesmo sem a chave do motor", async () => {
    const { org, callId } = await comAgente("desfecho só com a chave do endpoint");
    await liga(org, OUTCOME_SETTING);
    await comDestino(org, { baseUrl: "https://api.deepseek.com/v1", chave: CHAVE_DO_ENDPOINT });
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");

    const { fetch, pedidos } = pedidoCom({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." });
    await roda(org, callId, fetch);

    expect(pedidos).toEqual([{ url: "https://api.deepseek.com/v1/chat/completions", model: "gpt-5-nano", authorization: `Bearer ${CHAVE_DO_ENDPOINT}` }]);
    expect((await desfechoDe(callId))?.outcome).toBe("booked");
  });

  it("chave do endpoint recusada: a linha do tempo marca que a chave era a do endpoint, não a do motor", async () => {
    const { org, callId } = await comAgente("desfecho chave do endpoint recusada");
    await comChave(org);
    await liga(org, ANALYSIS_SETTING);
    await comDestino(org, { baseUrl: "https://api.deepseek.com/v1", chave: CHAVE_DO_ENDPOINT });
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");

    await roda(org, callId, erro(401));

    expect(await falhasDe(callId)).toEqual([{ reason: "rejected", engine: MOTOR, model: "gpt-5-nano", status: 401, costCents: 0, endpoint: true }]);
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([{ reason: "rejected", engine: MOTOR, model: "gpt-5-nano", status: 401, costCents: 0, endpoint: true }]);
  });

  it("sem destino configurado, o pedido é o de hoje: OpenAI, com o modelo de sempre e a chave do motor", async () => {
    const { org, callId } = await comAgente("desfecho sem destino");
    await comChave(org);
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");

    const { fetch, pedidos } = pedidoCom({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." });
    await roda(org, callId, fetch);

    expect(pedidos).toEqual([{ url: "https://api.openai.com/v1/chat/completions", model: "gpt-5-nano", authorization: CHAVE_DO_MOTOR }]);
  });

  it("só o modelo, sem endpoint e fora da tabela de preços: volta ao modelo do motor, com a chave do motor", async () => {
    const { org, callId } = await comAgente("desfecho só modelo");
    await comChave(org);
    // Gravado por fora do painel, que recusa modelo sem endpoint e sem preço conhecido.
    await comDestino(org, { modelo: "gpt-5-mini" });
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");

    const { fetch, pedidos } = pedidoCom({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." });
    await roda(org, callId, fetch);

    expect(pedidos).toEqual([{ url: "https://api.openai.com/v1/chat/completions", model: "gpt-5-nano", authorization: CHAVE_DO_MOTOR }]);
  });

  it.each([
    ["http em rede interna", "http://10.0.0.5:8080/v1"],
    ["IPv6 de uso local", "https://[fd00::1]/v1"],
    ["IPv6 link-local", "https://[fe80::1]/v1"],
    ["IPv4 embutido em IPv6", "https://[::ffff:7f00:1]/v1"],
    ["CGNAT", "https://100.64.0.1/v1"],
  ])("endpoint gravado por fora do painel (%s) não recebe nada, nem a OpenAI, e a linha do tempo diz por quê", async (_caso, baseUrl) => {
    const { org, callId } = await comAgente(`desfecho destino recusado ${baseUrl}`);
    await comChave(org);
    await comDestino(org, { baseUrl, modelo: "deepseek-chat", chave: CHAVE_DO_ENDPOINT });
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");

    const { fetch, pedidos } = pedidoCom({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." });
    await roda(org, callId, fetch);

    expect(pedidos).toEqual([]);
    expect(await falhasDe(callId)).toEqual([{ reason: "endpoint_refused", engine: MOTOR }]);
  });

  it.each([
    ["um IP interno", "https://10.0.0.1/v1/chat/completions"],
    ["um nome que resolve para dentro", "https://intranet.example.com/v1/chat/completions"],
  ])("endpoint público que redireciona para %s: a guarda recusa o salto, e nada vai além do primeiro pedido", async (_caso, destino) => {
    const { org, callId } = await comAgente(`desfecho redirecionado ${destino}`);
    await comChave(org);
    await comDestino(org, { baseUrl: "https://api.deepseek.com/v1", chave: CHAVE_DO_ENDPOINT });
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");

    const { fetch, pedidos } = pedidoCom({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." }, (url) =>
      url.startsWith("https://api.deepseek.com/") ? new Response(null, { status: 307, headers: { location: destino } }) : undefined,
    );
    await classifyCallOutcome.run(
      task(org, "classify_call_outcome", {}, callId),
      depsFor(app, { fetch, lookup: fakeLookup({ "intranet.example.com": ["10.0.0.7"] }) }),
    );

    expect(pedidos.map((pedido) => pedido.url)).toEqual(["https://api.deepseek.com/v1/chat/completions"]);
    // Sem status: o pedido não chegou a lugar nenhum além do endpoint, e nada dele vai à linha do tempo.
    expect(await falhasDe(callId)).toEqual([{ reason: "endpoint_refused", engine: MOTOR, model: "gpt-5-nano", status: null, costCents: 0, endpoint: true }]);
  });

  it("soma o que o provedor cobrou ao custo da chamada e ao extrato, pelo preço do modelo de texto", async () => {
    const { org, callId } = await comAgente("desfecho custo");
    await comChave(org);
    // A voz da chamada: 40 centavos, no extrato como na coluna.
    await withSystem(app, (q) =>
      q.exec("insert into usage_ledger (organization_id, call_id, engine, seconds, cost_cents, cost_microcents, at) values ($1, $2, $3, 60, 40, 40000000, $4)", [org, callId, MOTOR, new Date(t0.getTime() - 60_000)]),
    );
    await withSystem(app, (q) => q.exec("update calls set cost_cents = 40 where id = $1", [callId]));
    await fala(org, callId, "Me liga amanhã, por favor.");

    await roda(org, callId, openai({ outcome: "callback_requested", confidence: 0.8, evidence: "Me liga amanhã, por favor." }));

    expect(await custoDe(callId)).toEqual({
      call: 40 + CUSTO,
      extrato: [
        { engine: MOTOR, input_tokens: 0, output_tokens: 0, cost_cents: 40, cost_microcents: 40 * MICRO },
        { engine: MOTOR, input_tokens: 1_000_000, output_tokens: 100_000, cost_cents: CUSTO, cost_microcents: CUSTO_MICRO },
      ],
    });
  });

  it("uma classificação custa o valor de tabela, 0,034 centavo, e não um centavo inteiro na chamada", async () => {
    const { org, callId } = await comAgente("desfecho custo de tabela");
    await comChave(org);
    // A voz da mesma chamada já gastou 40 centavos, no extrato como na coluna.
    await withSystem(app, (q) =>
      q.exec("insert into usage_ledger (organization_id, call_id, engine, seconds, cost_cents, cost_microcents, at) values ($1, $2, $3, 60, 40, 40000000, $4)", [org, callId, MOTOR, new Date(t0.getTime() - 60_000)]),
    );
    await withSystem(app, (q) => q.exec("update calls set cost_cents = 40 where id = $1", [callId]));
    await fala(org, callId, "Me liga amanhã, por favor.");

    await roda(org, callId, openai({ outcome: "callback_requested", confidence: 0.8, evidence: "Me liga amanhã, por favor." }, 200, USO_CURTO));

    // Antes deste conserto: 40 centavos da voz + 1 centavo da classificação = 41, e o extrato dizia
    // 9 centavos para uma leitura de 0,034. Agora a fração inteira fica no extrato e o centavo
    // arredonda uma vez só, no total da chamada: 40,034 centavos.
    expect(await custoDe(callId)).toEqual({
      call: 40,
      extrato: [
        { engine: MOTOR, input_tokens: 0, output_tokens: 0, cost_cents: 40, cost_microcents: 40 * MICRO },
        { engine: MOTOR, input_tokens: 6_000, output_tokens: 100, cost_cents: 0, cost_microcents: CUSTO_CURTO },
      ],
    });
    expect(await microsDe(callId)).toBe(40 * MICRO + CUSTO_CURTO);
  });

  it("duas classificações na mesma chamada: a fração de cada uma soma no extrato antes de arredondar", async () => {
    const { org, callId } = await comAgente("desfecho custo de duas leituras");
    await comChave(org);
    await conversa(org, callId);
    // Primeira leitura: só o desfecho ligado.
    await roda(org, callId, openai({ outcome: "booked", confidence: 0.9, evidence: "Então pode marcar para terça." }, 200, USO_CURTO));
    // A análise ligada depois do desfecho gravado pede a segunda leitura, e ela é paga.
    await liga(org, ANALYSIS_SETTING);
    await roda(org, callId, openai(completa(), 200, USO_CURTO));

    // 0,034 + 0,034 = 0,068 centavo: antes eram dois centavos inteiros; agora nenhum, com a fração
    // toda guardada no extrato — é ela que o teto de gasto e a tela de custos leem.
    const custo = await custoDe(callId);
    expect(custo.call).toBe(0);
    expect(custo.extrato.map((linha) => linha.cost_microcents)).toEqual([CUSTO_CURTO, CUSTO_CURTO]);
    expect(await microsDe(callId)).toBe(2 * CUSTO_CURTO);
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
      ["fora do ar", erro(500), { reason: "provider_error", status: 500, costCents: 0 }],
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

/** Liga uma chave booleana da organização. */
const liga = (org: string, key: string): Promise<number> =>
  withSystem(app, (q) => q.exec("insert into settings (organization_id, key, value) values ($1, $2, 'true'::jsonb)", [org, key]));

/** Só a chave do motor, sem ligar nada. */
const soChave = (org: string, motor = MOTOR): Promise<number> =>
  withSystem(app, (q) => q.exec("insert into settings (organization_id, key, value) values ($1, $2, to_jsonb($3::text))", [org, `engine.${motor}.api_key`, encryptSecret("sk-de-teste", secretKey)]));

const falaDoAgente = (org: string, callId: string, texto: string): Promise<void> =>
  withOrg(app, org, (q) => recordEvent(q, callId, "transcript_agent", { text: texto }, t0));

const OBJECAO = { objection: "Preço", quote: "achei o preço caro demais", response: "Ofereceu parcelamento em três vezes.", handled: "addressed" };

/** A resposta completa que o modelo devolveria, com os critérios num objeto por id. */
const completa = (overrides: Record<string, unknown> = {}) => ({
  outcome: "booked",
  confidence: 0.9,
  evidence: "Então pode marcar para terça.",
  criteria: {
    opening: { status: "met", evidence: "Boa tarde, aqui é a Clínica Exemplo." },
    discovery: { status: "partial", evidence: "" },
    objections: { status: "met", evidence: "Temos parcelamento em três vezes." },
    accuracy: { status: "met", evidence: "frase que ninguém disse" },
    closing: { status: "missed", evidence: "" },
  },
  temperature: { start: "warm", middle: "cold", end: "hot" },
  objections: [OBJECAO],
  strengths: ["Ofereceu alternativa de pagamento."],
  weaknesses: ["Não confirmou o horário."],
  nextStep: "Confirmar a consulta de terça.",
  ...overrides,
});
/** met, partial, met, met, missed: 2 + 1 + 2 + 2 + 0. */
const NOTA = 7;

const conversa = async (org: string, callId: string): Promise<void> => {
  await falaDoAgente(org, callId, "Boa tarde, aqui é a Clínica Exemplo. Em que posso ajudar?");
  await fala(org, callId, "Queria marcar uma consulta, mas achei o preço caro demais.");
  await falaDoAgente(org, callId, "Entendo. Temos parcelamento em três vezes.");
  await fala(org, callId, "Então pode marcar para terça.");
};

const analiseDe = (callId: string) =>
  withSystem(app, (q) =>
    q.one<{ analysis: Record<string, unknown> | null; analysis_score: number | null; analyzed_at: Date | null; outcome: string | null; outcome_evidence: string | null }>(
      "select analysis, analysis_score, analyzed_at, outcome, outcome_evidence from calls where id = $1",
      [callId],
    ),
  );

const eventosDe = async (callId: string, kind: string) => (await eventsOf(app, callId)).filter((event) => event.kind === kind).map((event) => event.payload);

/** O corpo do pedido que o `fetch` falso recebeu, já lido. */
const pedidoDe = (fetch: typeof globalThis.fetch, index = 0) => JSON.parse(String((vi.mocked(fetch).mock.calls[index]?.[1] as RequestInit).body));

describe("classify_call_outcome: análise da ligação", () => {
  it("com as duas chaves desligadas não chama o provedor nem registra nada, mesmo com chave", async () => {
    const { org, callId } = await comAgente("analise desligada");
    await soChave(org);
    await conversa(org, callId);
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(await analiseDe(callId)).toMatchObject({ analysis: null, analysis_score: null, analyzed_at: null, outcome: null });
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([]);
  });

  it("só o desfecho ligado: o pedido continua o só de desfecho, e nenhum evento de análise", async () => {
    const { org, callId } = await comAgente("analise so desfecho");
    await comChave(org);
    await conversa(org, callId);
    const fetch = openai({ outcome: "booked", confidence: 0.9, evidence: "Então pode marcar para terça." });

    await roda(org, callId, fetch);

    expect(pedidoDe(fetch).response_format.json_schema.name).toBe("desfecho");
    expect(await analiseDe(callId)).toMatchObject({ analysis: null, analysis_score: null, outcome: "booked" });
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([]);
    expect(await eventosDe(callId, "call_analyzed")).toEqual([]);
  });

  it("sucesso: uma chamada paga, a nota da régua, a análise conferida e call_analyzed na linha do tempo", async () => {
    const { org, callId } = await comAgente("analise sucesso");
    await soChave(org);
    // Só a análise ligada: o desfecho vem junto, já pago.
    await liga(org, ANALYSIS_SETTING);
    await conversa(org, callId);
    // O modelo manda uma nota; ela não é lida.
    const fetch = openai({ ...completa(), score: 10 });

    await roda(org, callId, fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pedidoDe(fetch).response_format.json_schema.name).toBe("analise");
    const linha = await analiseDe(callId);
    expect(linha?.outcome).toBe("booked");
    expect(linha?.analysis_score).toBe(NOTA);
    expect(linha?.analyzed_at).toEqual(t0);
    const analysis = callAnalysisSchema.parse(linha?.analysis);
    expect(scoreOf(analysis.criteria)).toBe(NOTA);
    expect(analysis).toMatchObject({ rubricVersion: 1, model: "gpt-5-nano", droppedObjections: 0, objections: [OBJECAO], nextStep: "Confirmar a consulta de terça." });
    expect(analysis.criteria.map((criterion) => criterion.id)).toEqual([...ANALYSIS_CRITERIA]);
    // A evidência que ninguém disse sai; o status fica.
    expect(analysis.criteria.find((criterion) => criterion.id === "accuracy")).toEqual({ id: "accuracy", status: "met", evidence: "" });
    expect(analysis.criteria.find((criterion) => criterion.id === "opening")?.evidence).toBe("Boa tarde, aqui é a Clínica Exemplo.");
    expect(linha?.analysis).not.toHaveProperty("score");
    expect(await eventosDe(callId, "call_analyzed")).toEqual([{ score: NOTA, rubricVersion: 1, model: "gpt-5-nano", costCents: CUSTO, droppedObjections: 0 }]);
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([]);
    expect(await custoDe(callId)).toEqual({
      call: CUSTO,
      extrato: [{ engine: MOTOR, input_tokens: 1_000_000, output_tokens: 100_000, cost_cents: CUSTO, cost_microcents: CUSTO_MICRO }],
    });
  });

  it("reprocessar não paga de novo, com uma ou com as duas chaves ligadas", async () => {
    const { org, callId } = await comAgente("analise reprocesso");
    await comChave(org);
    await liga(org, ANALYSIS_SETTING);
    await conversa(org, callId);
    const fetch = openai(completa());

    await roda(org, callId, fetch);
    await roda(org, callId, fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await custoDe(callId)).extrato).toHaveLength(1);
    expect(await eventosDe(callId, "call_analyzed")).toHaveLength(1);
  });

  it("a análise ligada depois do desfecho gravado ainda é pedida, uma vez, e o desfecho não é reescrito", async () => {
    const { org, callId } = await comAgente("analise depois do desfecho");
    await comChave(org);
    await liga(org, ANALYSIS_SETTING);
    await conversa(org, callId);
    await withSystem(app, (q) => q.exec("update calls set outcome = 'callback_requested' where id = $1", [callId]));
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await analiseDe(callId)).toMatchObject({ outcome: "callback_requested", analysis_score: NOTA });
  });

  it("descarta a objeção inventada e a de uma palavra, e conta as duas", async () => {
    const { org, callId } = await comAgente("analise objecao inventada");
    await soChave(org);
    await liga(org, ANALYSIS_SETTING);
    await conversa(org, callId);
    const inventada = { ...OBJECAO, objection: "Confiança", quote: "não confio nessa clínica" };
    // "terça" está na fala de quem ligou, mas uma palavra só não sustenta objeção.
    const curta = { ...OBJECAO, objection: "Data", quote: "terça" };

    await roda(org, callId, openai(completa({ objections: [OBJECAO, inventada, curta] })));

    const analysis = callAnalysisSchema.parse((await analiseDe(callId))?.analysis);
    expect(analysis.objections).toEqual([OBJECAO]);
    expect(analysis.droppedObjections).toBe(2);
    expect((await eventosDe(callId, "call_analyzed"))[0]).toMatchObject({ droppedObjections: 2 });
  });

  it("sem fala transcrita não gasta chamada e diz por quê", async () => {
    const { org, callId } = await comAgente("analise sem fala");
    await comChave(org);
    await liga(org, ANALYSIS_SETTING);
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([{ reason: "no_speech", engine: MOTOR }]);
    expect(await falhasDe(callId)).toEqual([]);
  });

  it("sem chave não gasta chamada e diz por quê", async () => {
    const { org, callId } = await comAgente("analise sem chave");
    await liga(org, ANALYSIS_SETTING);
    await conversa(org, callId);
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([{ reason: "no_key", engine: MOTOR }]);
    expect((await analiseDe(callId))?.analysis).toBeNull();
  });

  it("motor simulado: não analisa, diz por quê, e o desfecho segue como antes", async () => {
    const { org, callId } = await comAgente("analise simulado", "simulated");
    await liga(org, OUTCOME_SETTING);
    await liga(org, ANALYSIS_SETTING);
    await conversa(org, callId);
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([{ reason: "engine_cannot_analyze", engine: "simulated" }]);
    expect(await analiseDe(callId)).toMatchObject({ analysis: null, analysis_score: null, outcome: null });
    expect(await falhasDe(callId)).toEqual([]);
  });

  it("no teto de custo do agente não cobra nada, e os dois eventos dizem por quê", async () => {
    const { org, callId } = await comAgente("analise teto");
    await comChave(org);
    await liga(org, ANALYSIS_SETTING);
    await withSystem(app, (q) => q.exec("update calls set cost_cents = 500 where id = $1", [callId]));
    await conversa(org, callId);
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    const teto = { reason: "cost_ceiling", engine: MOTOR, costCents: 500, ceilingCents: 500 };
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([teto]);
    expect(await falhasDe(callId)).toEqual([teto]);
    expect(await custoDe(callId)).toEqual({ call: 500, extrato: [] });
  });

  it("provedor falhando: com as duas chaves, os dois eventos; só com a análise, só o dela", async () => {
    const casos: Array<[string, typeof globalThis.fetch, Record<string, unknown>]> = [
      ["401", erro(401), { reason: "rejected", status: 401, costCents: 0 }],
      ["fora do ar", erro(500), { reason: "provider_error", status: 500, costCents: 0 }],
      // Fora da forma foi cobrado: o custo entra uma vez, e nada é gravado, nem o desfecho.
      ["seis objeções", openai(completa({ objections: Array.from({ length: 6 }, () => OBJECAO) })), { reason: "unexpected_response", status: 200, costCents: CUSTO }],
      ["só o desfecho", openai({ outcome: "booked", confidence: 0.9, evidence: "Então pode marcar para terça." }), { reason: "unexpected_response", status: 200, costCents: CUSTO }],
    ];
    for (const duas of [true, false]) {
      for (const [nome, fetch, esperado] of casos) {
        const rotulo = `${nome} (${duas ? "duas chaves" : "só análise"})`;
        const { org, callId } = await comAgente(`analise falha ${rotulo}`);
        await soChave(org);
        if (duas) await liga(org, OUTCOME_SETTING);
        await liga(org, ANALYSIS_SETTING);
        await conversa(org, callId);
        vi.mocked(fetch).mockClear();

        await roda(org, callId, fetch);

        expect(fetch, rotulo).toHaveBeenCalledTimes(1);
        const evento = { engine: MOTOR, model: "gpt-5-nano", ...esperado };
        expect(await eventosDe(callId, "analysis_not_done"), rotulo).toEqual([evento]);
        expect(await falhasDe(callId), rotulo).toEqual(duas ? [evento] : []);
        expect(await analiseDe(callId), rotulo).toMatchObject({ analysis: null, analysis_score: null, analyzed_at: null, outcome: null });
        expect(await custoDe(callId), rotulo).toMatchObject({ call: esperado.costCents, extrato: esperado.costCents ? [{ cost_cents: CUSTO }] : [] });
        expect(JSON.stringify(await eventsOf(app, callId)), rotulo).not.toContain("sk-de-teste");
      }
    }
  });

  it("o titular pede o apagamento enquanto o provedor responde: o desfecho, a nota e o custo ficam, o texto da análise não", async () => {
    const { org, callId } = await comAgente("analise apagada no meio");
    await comChave(org);
    await liga(org, ANALYSIS_SETTING);
    await conversa(org, callId);
    const responde = openai(completa());
    // O apagamento confirma depois de a rotina ler as falas e antes de ela gravar.
    const apagaNoMeio = vi.fn(async (...args: Parameters<typeof fetch>) => {
      await withSystem(app, (q) => q.exec("update calls set erased_at = $2 where id = $1", [callId, t0]));
      return responde(...args);
    }) as unknown as typeof fetch;

    await roda(org, callId, apagaNoMeio);

    expect(await analiseDe(callId)).toMatchObject({ analysis: null, analysis_score: NOTA, analyzed_at: t0, outcome: "booked", outcome_evidence: null });
    expect((await custoDe(callId)).call).toBe(CUSTO);
    // Rodar de novo não paga outra vez para a mesma chamada apagada.
    await roda(org, callId, apagaNoMeio);
    expect(apagaNoMeio).toHaveBeenCalledTimes(1);
  });

  it("conversa acima de 6 000 caracteres: o pedido completo leva o começo, o só de desfecho continua levando só o fim", async () => {
    // Cerca de 12 000 caracteres: passa dos 6 000 do corte do desfecho e fica abaixo dos 24 000 do motor.
    const longa = async (org: string, callId: string): Promise<void> => {
      await fala(org, callId, "Primeira fala: achei o preço caro demais.");
      for (let i = 0; i < 100; i++) await falaDoAgente(org, callId, `Fala do meio número ${String(i).padStart(3, "0")}, ${"com bastante conteúdo ".repeat(4)}`);
      await fala(org, callId, "Última fala: então pode marcar para terça.");
    };
    const completo = await comAgente("analise conversa longa");
    await soChave(completo.org);
    await liga(completo.org, ANALYSIS_SETTING);
    await longa(completo.org, completo.callId);
    const soDesfecho = await comAgente("desfecho conversa longa");
    await comChave(soDesfecho.org);
    await longa(soDesfecho.org, soDesfecho.callId);
    const fetchCompleto = openai(completa());
    const fetchDesfecho = openai({ outcome: "booked", confidence: 0.9, evidence: "então pode marcar para terça." });

    await roda(completo.org, completo.callId, fetchCompleto);
    await roda(soDesfecho.org, soDesfecho.callId, fetchDesfecho);

    const textoCompleto: string = pedidoDe(fetchCompleto).messages[0].content;
    expect(textoCompleto.length).toBeGreaterThan(10_000);
    expect(textoCompleto).toContain("Cliente: Primeira fala: achei o preço caro demais.");
    expect(textoCompleto).toContain("Fala do meio número 000");
    expect(textoCompleto).toContain("Cliente: Última fala: então pode marcar para terça.");
    expect(textoCompleto).not.toContain(OMITTED_TURNS_MARK);
    const textoDesfecho: string = pedidoDe(fetchDesfecho).messages[0].content;
    expect(textoDesfecho).not.toContain("Primeira fala");
    expect(textoDesfecho).toContain("Cliente: Última fala: então pode marcar para terça.");
    expect((await analiseDe(completo.callId))?.analysis_score).toBe(NOTA);
  });

  it("análise que passa pela resposta e cai no schema de gravação: unexpected_response, custo uma vez e nada gravado", async () => {
    const { org, callId } = await comAgente("analise fora do schema de gravacao", FALSO.id);
    await comChave(org, FALSO.id);
    await liga(org, ANALYSIS_SETTING);
    await conversa(org, callId);
    // Quatro pontos fortes: o schema de gravação aceita até três. O resto está na forma.
    const { outcome, confidence, evidence, criteria, ...resto } = completa({ strengths: ["um", "dois", "três", "quatro"] });
    FALSO.classifyOutcome.mockResolvedValueOnce({
      ok: true,
      guess: { outcome, confidence, evidence },
      analysis: { ...resto, criteria: ANALYSIS_CRITERIA.map((id) => ({ id, ...(criteria as Record<string, { status: string; evidence: string }>)[id] })) },
      model: "modelo-falso",
      usage: { inputTokens: 10, outputTokens: 5 },
      costCents: 3,
      costMicrocents: 3_000_000,
    });

    await roda(org, callId, openai(completa()));

    expect(FALSO.classifyOutcome).toHaveBeenCalledTimes(1);
    expect(FALSO.classifyOutcome.mock.calls[0]?.[1]).toMatchObject({ analyze: true });
    const evento = { reason: "unexpected_response", engine: FALSO.id, model: "modelo-falso", status: 200, costCents: 3 };
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([evento]);
    expect(await falhasDe(callId)).toEqual([evento]);
    expect(await eventosDe(callId, "call_analyzed")).toEqual([]);
    expect(await analiseDe(callId)).toMatchObject({ analysis: null, analysis_score: null, analyzed_at: null, outcome: null });
    expect(await custoDe(callId)).toMatchObject({ call: 3, extrato: [{ engine: FALSO.id, input_tokens: 10, output_tokens: 5, cost_cents: 3 }] });
  });
});

describe("classify_call_outcome: o cérebro escolhido para ler a ligação", () => {
  /** Centavos por milhão: US$ 0,05 de entrada e US$ 0,40 de saída, com fonte e data, como a lista guarda. */
  const PRECO = { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "https://exemplo.invalid/precos", checkedOn: "2031-03-01" };
  const COM_PRECO: BrainModel = { id: "modelo-com-preco", label: "Com preço", price: PRECO };
  const SEM_PRECO: BrainModel = { id: "modelo-sem-preco", label: "Sem preço" };
  const CHAVE_DO_CEREBRO = "sk-do-cerebro";

  /** A chave do cérebro, cifrada, e a lista guardada dela: o que a tela de Cérebros grava. */
  const comCerebro = (org: string, cerebro: string, modelos: BrainModel[], chave = true): Promise<void> =>
    withSystem(app, async (q) => {
      if (chave) await q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, to_jsonb($3::text), true)", [org, `brain.${cerebro}.api_key`, encryptSecret(CHAVE_DO_CEREBRO, secretKey)]);
      await q.exec("insert into settings (organization_id, key, value) values ($1, $2, $3)", [org, `brain.${cerebro}.models`, JSON.stringify({ fetchedAt: t0.toISOString(), models: modelos })]);
    });

  const escolhe = (org: string, cerebro: string, modelo: string): Promise<number> =>
    withSystem(app, (q) => q.exec("insert into settings (organization_id, key, value) values ($1, 'calls.analysis_brain', $2)", [org, JSON.stringify({ brain: cerebro, model: modelo })]));

  const semTeto = (org: string): Promise<number> => withSystem(app, (q) => q.exec("update agents set cost_ceiling_cents = 0 where organization_id = $1", [org]));

  /** Desfecho e análise ligados, a chave do motor salva e a conversa de sempre. */
  const pronta = async (label: string): Promise<{ org: string; callId: string }> => {
    const ligacao = await comAgente(label);
    await comChave(ligacao.org);
    await liga(ligacao.org, ANALYSIS_SETTING);
    await conversa(ligacao.org, ligacao.callId);
    return ligacao;
  };

  const extratoDe = (callId: string) =>
    withSystem(app, async (q) =>
      (
        await q.many<{ engine: string; model: string | null; cost_measured: boolean; input_tokens: number; output_tokens: number; cost_microcents: string }>(
          "select engine, model, cost_measured, input_tokens, output_tokens, cost_microcents from usage_ledger where call_id = $1 order by at, id",
          [callId],
        )
      ).map((linha) => ({ ...linha, cost_microcents: Number(linha.cost_microcents) })),
    );

  /** O cérebro falso responde a análise completa, com o consumo dado. */
  const cerebroResponde = (usage: object, model = COM_PRECO.id): void => {
    CEREBRO.completeJson.mockResolvedValueOnce({ ok: true, text: JSON.stringify(completa()), model, usage });
  };

  it("sem escolha, nada muda: a linha do extrato é a do motor, sem modelo e com o custo medido", async () => {
    const { org, callId } = await pronta("cerebro sem escolha");
    await comCerebro(org, CEREBRO.id, [COM_PRECO]);
    const calls = CEREBRO.completeJson.mock.calls.length;
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
    expect(await extratoDe(callId)).toEqual([{ engine: MOTOR, model: null, cost_measured: true, input_tokens: 1_000_000, output_tokens: 100_000, cost_microcents: CUSTO_MICRO }]);
    expect(await eventosDe(callId, "call_analyzed")).toEqual([{ score: NOTA, rubricVersion: 1, model: "gpt-5-nano", costCents: CUSTO, droppedObjections: 0 }]);
  });

  it("com escolha, quem lê é o cérebro, com a chave dele, e o custo sai do preço da lista guardada", async () => {
    const { org, callId } = await pronta("cerebro openai");
    // O preço da lista guardada vale, e não o da tabela do arquivo: aqui ele é inventado de propósito.
    await comCerebro(org, "openai", [{ id: "gpt-5-mini", label: "GPT-5 mini", price: PRECO }]);
    await escolhe(org, "openai", "gpt-5-mini");
    const { fetch, pedidos } = pedidoCom(completa());

    await roda(org, callId, fetch);

    // Um pedido só, ao cérebro, com a chave dele; a do motor não sai.
    expect(pedidos).toEqual([{ url: "https://api.openai.com/v1/chat/completions", model: "gpt-5-mini", authorization: `Bearer ${CHAVE_DO_CEREBRO}` }]);
    expect(pedidoDe(fetch).response_format.json_schema.name).toBe("analise");
    // 800 mil de entrada cheia e 200 mil em cache (sem preço de cache, vale o cheio) a 5 centavos,
    // mais 100 mil de saída a 40: 5 + 4 = 9 centavos.
    expect(await extratoDe(callId)).toEqual([{ engine: "brain:openai", model: "gpt-5-mini", cost_measured: true, input_tokens: 1_000_000, output_tokens: 100_000, cost_microcents: 9_000_000 }]);
    expect((await custoDe(callId)).call).toBe(9);
    expect(await eventosDe(callId, "call_analyzed")).toEqual([{ score: NOTA, rubricVersion: 1, model: "gpt-5-mini", costCents: 9, droppedObjections: 0, brain: "openai", costMeasured: true, choiceFrom: "organization" }]);
    expect((await analiseDe(callId))?.outcome).toBe("booked");
    // A chave nunca aparece num evento.
    expect(JSON.stringify(await eventsOf(app, callId))).not.toContain(CHAVE_DO_CEREBRO);
  });

  it("a escolha passa na frente do classify_target: o endpoint configurado não recebe nada", async () => {
    const { org, callId } = await pronta("cerebro na frente do destino");
    await comDestino(org, { baseUrl: "https://api.deepseek.com/v1", modelo: "deepseek-chat", chave: CHAVE_DO_ENDPOINT });
    await comCerebro(org, CEREBRO.id, [COM_PRECO]);
    await escolhe(org, CEREBRO.id, COM_PRECO.id);
    cerebroResponde({ inputTokens: 1000, outputTokens: 100 });
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(CEREBRO.completeJson.mock.calls.at(-1)?.[0]).toBe(CHAVE_DO_CEREBRO);
    expect(CEREBRO.completeJson.mock.calls.at(-1)?.[1]).toMatchObject({ model: COM_PRECO.id, schema: { name: "analise" }, timeoutMs: 30_000 });
    expect((await eventosDe(callId, "call_analyzed"))[0]).toMatchObject({ brain: CEREBRO.id, costMeasured: true });
  });

  it("só o desfecho ligado: o cérebro recebe o pedido só de desfecho", async () => {
    const { org, callId } = await comAgente("cerebro so desfecho");
    await comChave(org);
    await fala(org, callId, "Pode marcar quinta às dez, por favor.");
    await comCerebro(org, CEREBRO.id, [COM_PRECO]);
    await escolhe(org, CEREBRO.id, COM_PRECO.id);
    CEREBRO.completeJson.mockResolvedValueOnce({ ok: true, text: JSON.stringify({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta às dez, por favor." }), model: COM_PRECO.id, usage: { inputTokens: 10, outputTokens: 5 } });

    await roda(org, callId, openai({}));

    expect(CEREBRO.completeJson.mock.calls.at(-1)?.[1]).toMatchObject({ schema: { name: "desfecho" }, timeoutMs: 10_000 });
    expect((await desfechoDe(callId))?.outcome).toBe("booked");
    expect(await eventosDe(callId, "call_analyzed")).toEqual([]);
  });

  it.each([
    ["o cérebro sumiu da pasta", "cerebro-que-sumiu", COM_PRECO.id],
    ["o modelo saiu da lista guardada", CEREBRO.id, "modelo-que-saiu"],
  ])("brain_unavailable quando %s: nada é pedido, nem ao motor", async (_caso, cerebro, modelo) => {
    const { org, callId } = await pronta(`cerebro indisponivel ${cerebro} ${modelo}`);
    await comCerebro(org, cerebro, [COM_PRECO]);
    await escolhe(org, cerebro, modelo);
    const calls = CEREBRO.completeJson.mock.calls.length;
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
    const evento = { reason: "brain_unavailable", brain: cerebro, model: modelo, choiceFrom: "organization" };
    expect(await falhasDe(callId)).toEqual([evento]);
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([evento]);
    expect(await extratoDe(callId)).toEqual([]);
  });

  it.each([
    ["sem o modelo", { brain: "openai" }],
    ["com o cérebro em número", { brain: 1, model: "modelo-com-preco" }],
    ["com o modelo vazio", { brain: "openai", model: "" }],
    ["um texto solto", "openai"],
    ["uma lista", ["openai", "modelo-com-preco"]],
  ])("a escolha fora da forma (%s, gravada à mão) é brain_unavailable e nunca cai no motor", async (_caso, valor) => {
    const { org, callId } = await pronta(`cerebro fora da forma ${JSON.stringify(valor)}`);
    await comCerebro(org, "openai", [COM_PRECO]);
    await withSystem(app, (q) => q.exec("insert into settings (organization_id, key, value) values ($1, 'calls.analysis_brain', $2)", [org, JSON.stringify(valor)]));
    const calls = CEREBRO.completeJson.mock.calls.length;
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
    const evento = { reason: "brain_unavailable", brain: null, model: null, choiceFrom: "organization" };
    expect(await falhasDe(callId)).toEqual([evento]);
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([evento]);
    expect(await extratoDe(callId)).toEqual([]);
  });

  it("brain_no_key: o cérebro escolhido sem chave não lê, e a chave do motor não é usada", async () => {
    const { org, callId } = await pronta("cerebro sem chave");
    await comCerebro(org, CEREBRO.id, [COM_PRECO], false);
    await escolhe(org, CEREBRO.id, COM_PRECO.id);
    const calls = CEREBRO.completeJson.mock.calls.length;
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
    const evento = { reason: "brain_no_key", brain: CEREBRO.id, model: COM_PRECO.id, choiceFrom: "organization" };
    expect(await falhasDe(callId)).toEqual([evento]);
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([evento]);
  });

  it("modelo sem preço com agente sem teto: brain_unmeasured_without_ceiling, e nada é pedido", async () => {
    const { org, callId } = await pronta("cerebro sem preco sem teto");
    await semTeto(org);
    await comCerebro(org, CEREBRO.id, [SEM_PRECO]);
    await escolhe(org, CEREBRO.id, SEM_PRECO.id);
    const calls = CEREBRO.completeJson.mock.calls.length;
    const fetch = openai(completa());

    await roda(org, callId, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
    const evento = { reason: "brain_unmeasured_without_ceiling", brain: CEREBRO.id, model: SEM_PRECO.id, choiceFrom: "organization" };
    expect(await falhasDe(callId)).toEqual([evento]);
    expect(await eventosDe(callId, "analysis_not_done")).toEqual([evento]);
  });

  it("modelo sem preço com teto: lê, e o extrato guarda os tokens com o custo não medido", async () => {
    const { org, callId } = await pronta("cerebro sem preco com teto");
    await comCerebro(org, CEREBRO.id, [SEM_PRECO]);
    await escolhe(org, CEREBRO.id, SEM_PRECO.id);
    cerebroResponde({ inputTokens: 1000, outputTokens: 100 }, SEM_PRECO.id);

    await roda(org, callId, openai(completa()));

    expect(await extratoDe(callId)).toEqual([{ engine: `brain:${CEREBRO.id}`, model: SEM_PRECO.id, cost_measured: false, input_tokens: 1000, output_tokens: 100, cost_microcents: 0 }]);
    expect(await eventosDe(callId, "call_analyzed")).toEqual([{ score: NOTA, rubricVersion: 1, model: SEM_PRECO.id, costCents: 0, droppedObjections: 0, brain: CEREBRO.id, costMeasured: false, choiceFrom: "organization" }]);
  });

  it("modelo com preço e agente sem teto: lê normalmente, com o custo medido", async () => {
    const { org, callId } = await pronta("cerebro com preco sem teto");
    await semTeto(org);
    await comCerebro(org, CEREBRO.id, [COM_PRECO]);
    await escolhe(org, CEREBRO.id, COM_PRECO.id);
    cerebroResponde({ inputTokens: 1_000_000, outputTokens: 0 });

    await roda(org, callId, openai(completa()));

    expect(await extratoDe(callId)).toEqual([{ engine: `brain:${CEREBRO.id}`, model: COM_PRECO.id, cost_measured: true, input_tokens: 1_000_000, output_tokens: 0, cost_microcents: 5_000_000 }]);
  });

  it("no teto do agente, o cérebro também não é chamado", async () => {
    const { org, callId } = await pronta("cerebro no teto");
    await withSystem(app, (q) => q.exec("update calls set cost_cents = 500 where id = $1", [callId]));
    await comCerebro(org, CEREBRO.id, [COM_PRECO]);
    await escolhe(org, CEREBRO.id, COM_PRECO.id);
    const calls = CEREBRO.completeJson.mock.calls.length;

    await roda(org, callId, openai(completa()));

    expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
    expect(await falhasDe(callId)).toEqual([{ reason: "cost_ceiling", brain: CEREBRO.id, model: COM_PRECO.id, choiceFrom: "organization", costCents: 500, ceilingCents: 500 }]);
  });

  describe("custo desconhecido, nunca zero medido", () => {
    it("resultado sem usage, com preço conhecido: a linha diz não medido", async () => {
      const { org, callId } = await pronta("cerebro resultado sem usage");
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolhe(org, CEREBRO.id, COM_PRECO.id);
      cerebroResponde({});

      await roda(org, callId, openai(completa()));

      expect(await extratoDe(callId)).toEqual([{ engine: `brain:${CEREBRO.id}`, model: COM_PRECO.id, cost_measured: false, input_tokens: 0, output_tokens: 0, cost_microcents: 0 }]);
      expect((await eventosDe(callId, "call_analyzed"))[0]).toMatchObject({ costCents: 0, costMeasured: false });
    });

    it("prazo vencido sem resposta (status nulo): pode ter sido cobrado, então é não medido", async () => {
      const { org, callId } = await pronta("cerebro prazo vencido");
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolhe(org, CEREBRO.id, COM_PRECO.id);
      CEREBRO.completeJson.mockResolvedValueOnce({ ok: false, failure: "unreachable", status: null, model: COM_PRECO.id, usage: {} });

      await roda(org, callId, openai(completa()));

      const evento = { reason: "unreachable", brain: CEREBRO.id, model: COM_PRECO.id, status: null, costCents: 0, costMeasured: false, choiceFrom: "organization" };
      expect(await falhasDe(callId)).toEqual([evento]);
      expect(await eventosDe(callId, "analysis_not_done")).toEqual([evento]);
      expect(await extratoDe(callId)).toEqual([{ engine: `brain:${CEREBRO.id}`, model: COM_PRECO.id, cost_measured: false, input_tokens: 0, output_tokens: 0, cost_microcents: 0 }]);
    });

    it("chave recusada (401): nada foi cobrado, o zero é medido e não há linha no extrato", async () => {
      const { org, callId } = await pronta("cerebro chave recusada");
      await comCerebro(org, CEREBRO.id, [SEM_PRECO]);
      await escolhe(org, CEREBRO.id, SEM_PRECO.id);
      CEREBRO.completeJson.mockResolvedValueOnce({ ok: false, failure: "rejected", status: 401, model: SEM_PRECO.id, usage: {} });

      await roda(org, callId, openai(completa()));

      expect(await falhasDe(callId)).toEqual([{ reason: "rejected", brain: CEREBRO.id, model: SEM_PRECO.id, status: 401, costCents: 0, costMeasured: true, choiceFrom: "organization" }]);
      expect(await extratoDe(callId)).toEqual([]);
    });

    /** O corpo de `/v1/messages` com o JSON da análise no texto e o consumo dado. */
    const anthropic = (usage: object | undefined): typeof fetch =>
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(completa()) }], stop_reason: "end_turn", ...(usage && { usage }) }), { status: 200 }),
      ) as unknown as typeof fetch;

    it("DeepSeek sem preço, com o usage sem inputTokens: não medido", async () => {
      const { org, callId } = await pronta("cerebro deepseek");
      await comCerebro(org, "deepseek", [{ id: "deepseek-chat", label: "deepseek-chat" }]);
      await escolhe(org, "deepseek", "deepseek-chat");
      const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(completa()) } }] }), { status: 200 })) as unknown as typeof globalThis.fetch;

      await roda(org, callId, fetch);

      expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://api.deepseek.com/chat/completions");
      expect(await extratoDe(callId)).toEqual([{ engine: "brain:deepseek", model: "deepseek-chat", cost_measured: false, input_tokens: 0, output_tokens: 0, cost_microcents: 0 }]);
      expect((await eventosDe(callId, "call_analyzed"))[0]).toMatchObject({ brain: "deepseek", costMeasured: false });
    });

    it("Haiku 5.5 (preço por faixa, sem preço na lista), com o usage sem inputTokens: não medido", async () => {
      const { org, callId } = await pronta("cerebro haiku 5.5");
      await comCerebro(org, "anthropic", [{ id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }]);
      await escolhe(org, "anthropic", "claude-haiku-5-5");
      const fetch = anthropic(undefined);

      await roda(org, callId, fetch);

      expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
      expect(await extratoDe(callId)).toEqual([{ engine: "brain:anthropic", model: "claude-haiku-5-5", cost_measured: false, input_tokens: 0, output_tokens: 0, cost_microcents: 0 }]);
      expect((await eventosDe(callId, "call_analyzed"))[0]).toMatchObject({ brain: "anthropic", costMeasured: false });
    });

    it("escrita em cache da Anthropic, num modelo com preço: o consumo volta vazio, e é não medido", async () => {
      const { org, callId } = await pronta("cerebro anthropic cache");
      await comCerebro(org, "anthropic", [{ id: "claude-sonnet-com-preco", label: "Sonnet", price: PRECO }]);
      await escolhe(org, "anthropic", "claude-sonnet-com-preco");
      const fetch = anthropic({ input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 5000 });

      await roda(org, callId, fetch);

      expect(await extratoDe(callId)).toEqual([{ engine: "brain:anthropic", model: "claude-sonnet-com-preco", cost_measured: false, input_tokens: 0, output_tokens: 0, cost_microcents: 0 }]);
      expect((await eventosDe(callId, "call_analyzed"))[0]).toMatchObject({ brain: "anthropic", costMeasured: false, costCents: 0 });
    });
  });

  it("remover a escolha faz a próxima ligação voltar ao motor", async () => {
    const { org, callId } = await pronta("cerebro removido");
    await comCerebro(org, CEREBRO.id, [COM_PRECO]);
    await escolhe(org, CEREBRO.id, COM_PRECO.id);
    cerebroResponde({ inputTokens: 10, outputTokens: 5 });
    await roda(org, callId, openai(completa()));
    expect((await extratoDe(callId))[0]?.engine).toBe(`brain:${CEREBRO.id}`);

    await withSystem(app, (q) => q.exec("delete from settings where organization_id = $1 and key = 'calls.analysis_brain'", [org]));
    const outra = await createCall(app, org, t0);
    await withSystem(app, (q) => q.exec("update calls set agent_id = (select agent_id from calls where id = $2) where id = $1", [outra, callId]));
    await conversa(org, outra);
    const calls = CEREBRO.completeJson.mock.calls.length;
    const fetch = openai(completa());

    await roda(org, outra, fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
    expect(await extratoDe(outra)).toEqual([{ engine: MOTOR, model: null, cost_measured: true, input_tokens: 1_000_000, output_tokens: 100_000, cost_microcents: CUSTO_MICRO }]);
  });

  it("remover a escolha com o classify_target gravado volta ao endpoint", async () => {
    const { org, callId } = await pronta("cerebro removido volta ao endpoint");
    await comDestino(org, { baseUrl: "https://api.deepseek.com/v1", modelo: "deepseek-chat", chave: CHAVE_DO_ENDPOINT });
    await comCerebro(org, CEREBRO.id, [COM_PRECO]);
    await escolhe(org, CEREBRO.id, COM_PRECO.id);
    cerebroResponde({ inputTokens: 10, outputTokens: 5 });
    const antes = pedidoCom(completa());

    // Com a escolha, quem lê é o cérebro, e o endpoint não recebe nada.
    await roda(org, callId, antes.fetch);
    expect(antes.pedidos).toEqual([]);
    expect((await extratoDe(callId))[0]?.engine).toBe(`brain:${CEREBRO.id}`);

    await withSystem(app, (q) => q.exec("delete from settings where organization_id = $1 and key = 'calls.analysis_brain'", [org]));
    const outra = await createCall(app, org, t0);
    await withSystem(app, (q) => q.exec("update calls set agent_id = (select agent_id from calls where id = $2) where id = $1", [outra, callId]));
    await conversa(org, outra);
    const calls = CEREBRO.completeJson.mock.calls.length;
    const { fetch, pedidos } = pedidoCom(completa());

    await roda(org, outra, fetch);

    // Sem a escolha, o destino que continuou gravado volta a valer.
    expect(pedidos).toEqual([{ url: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat", authorization: `Bearer ${CHAVE_DO_ENDPOINT}` }]);
    expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
  });

  describe("a escolha de cada agente (agents.analysis_brain)", () => {
    const OUTRO_COM_PRECO: BrainModel = { id: "outro-modelo-com-preco", label: "Outro com preço", price: { ...PRECO, centsPerMillionInputTokens: 10 } };

    /** Grava a escolha no agente da ligação como o painel faria; um valor qualquer simula o banco editado à mão. */
    const escolheNoAgente = (callId: string, valor: unknown): Promise<number> =>
      withSystem(app, (q) => q.exec("update agents set analysis_brain = $2::jsonb where id = (select agent_id from calls where id = $1)", [callId, JSON.stringify(valor)]));

    /** Outro agente na mesma organização, com uma ligação dele e a conversa de sempre. */
    const outroAgente = async (org: string, nome: string): Promise<string> => {
      const agentId = await withSystem(app, async (q) => (await q.one<{ id: string }>("insert into agents (organization_id, name, engine) values ($1, $2, $3) returning id", [org, nome, MOTOR]))?.id as string);
      const callId = await createCall(app, org, t0);
      await withSystem(app, (q) => q.exec("update calls set agent_id = $2 where id = $1", [callId, agentId]));
      await conversa(org, callId);
      return callId;
    };

    /** O cérebro falso responde a análise completa com o modelo que foi pedido: o extrato diz quem leu. */
    const cerebroEcoa = (usage: object = { inputTokens: 1000, outputTokens: 100 }): void => {
      CEREBRO.completeJson.mockImplementationOnce(async (_chave: string, pedido: { model: string }) => ({ ok: true, text: JSON.stringify(completa()), model: pedido.model, usage }));
    };

    it("T1: dois agentes com modelos diferentes: cada ligação é lida pelo modelo do próprio agente, e a organização não é usada", async () => {
      const { org, callId: deVendas } = await pronta("agente t1");
      const deSuporte = await outroAgente(org, "Suporte");
      await comCerebro(org, CEREBRO.id, [COM_PRECO, OUTRO_COM_PRECO]);
      // A organização escolheu outro cérebro: com os dois agentes escolhendo, ele não recebe nada.
      await comCerebro(org, "openai", [{ id: "gpt-5-mini", label: "GPT-5 mini", price: PRECO }]);
      await escolhe(org, "openai", "gpt-5-mini");
      await escolheNoAgente(deVendas, { kind: "brain", brain: CEREBRO.id, model: COM_PRECO.id });
      await escolheNoAgente(deSuporte, { kind: "brain", brain: CEREBRO.id, model: OUTRO_COM_PRECO.id });
      const fetch = openai(completa());

      cerebroEcoa();
      await roda(org, deVendas, fetch);
      expect(CEREBRO.completeJson.mock.calls.at(-1)?.[1]).toMatchObject({ model: COM_PRECO.id });
      cerebroEcoa();
      await roda(org, deSuporte, fetch);
      expect(CEREBRO.completeJson.mock.calls.at(-1)?.[1]).toMatchObject({ model: OUTRO_COM_PRECO.id });

      expect(fetch).not.toHaveBeenCalled();
      // 1 000 de entrada e 100 de saída: a 5 e 40 centavos por milhão, 9 000 µ¢; a 10 e 40, 14 000 µ¢.
      expect(await extratoDe(deVendas)).toEqual([{ engine: `brain:${CEREBRO.id}`, model: COM_PRECO.id, cost_measured: true, input_tokens: 1000, output_tokens: 100, cost_microcents: 9_000 }]);
      expect(await extratoDe(deSuporte)).toEqual([{ engine: `brain:${CEREBRO.id}`, model: OUTRO_COM_PRECO.id, cost_measured: true, input_tokens: 1000, output_tokens: 100, cost_microcents: 14_000 }]);
      expect((await eventosDe(deVendas, "call_analyzed"))[0]).toMatchObject({ brain: CEREBRO.id, model: COM_PRECO.id, choiceFrom: "agent" });
      expect((await eventosDe(deSuporte, "call_analyzed"))[0]).toMatchObject({ brain: CEREBRO.id, model: OUTRO_COM_PRECO.id, choiceFrom: "agent" });
    });

    it("T2 e T8: o agente sem escolha (coluna nula, como toda linha que já existia) segue a organização", async () => {
      const { org, callId } = await pronta("agente t2");
      expect(await withSystem(app, async (q) => (await q.one<{ n: string }>("select count(*) as n from agents where organization_id = $1 and analysis_brain is not null", [org]))?.n)).toBe("0");
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolhe(org, CEREBRO.id, COM_PRECO.id);
      cerebroEcoa();
      const fetch = openai(completa());

      await roda(org, callId, fetch);

      expect(fetch).not.toHaveBeenCalled();
      expect(CEREBRO.completeJson.mock.calls.at(-1)?.[1]).toMatchObject({ model: COM_PRECO.id });
      expect((await eventosDe(callId, "call_analyzed"))[0]).toMatchObject({ brain: CEREBRO.id, model: COM_PRECO.id, choiceFrom: "organization" });
    });

    it("T3: o agente com o motor dele lê pelo motor, mesmo com um cérebro escolhido na organização", async () => {
      const { org, callId } = await pronta("agente t3");
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolhe(org, CEREBRO.id, COM_PRECO.id);
      await escolheNoAgente(callId, { kind: "engine" });
      const calls = CEREBRO.completeJson.mock.calls.length;
      const fetch = openai(completa());

      await roda(org, callId, fetch);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
      expect(await extratoDe(callId)).toEqual([{ engine: MOTOR, model: null, cost_measured: true, input_tokens: 1_000_000, output_tokens: 100_000, cost_microcents: CUSTO_MICRO }]);
      // O caminho do motor não muda: o evento é o de antes, sem cérebro e sem de quem é a escolha.
      expect(await eventosDe(callId, "call_analyzed")).toEqual([{ score: NOTA, rubricVersion: 1, model: "gpt-5-nano", costCents: CUSTO, droppedObjections: 0 }]);
    });

    it("T3: o motor do agente segue o classify_target da organização, como o motor de hoje", async () => {
      const { org, callId } = await pronta("agente t3 destino");
      await comDestino(org, { baseUrl: "https://api.deepseek.com/v1", modelo: "deepseek-chat", chave: CHAVE_DO_ENDPOINT });
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolhe(org, CEREBRO.id, COM_PRECO.id);
      await escolheNoAgente(callId, { kind: "engine" });
      const { fetch, pedidos } = pedidoCom(completa());

      await roda(org, callId, fetch);

      expect(pedidos).toEqual([{ url: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat", authorization: `Bearer ${CHAVE_DO_ENDPOINT}` }]);
    });

    it("T4: a chave do cérebro do agente foi removida: brain_no_key, e nada sai, nem pela organização nem pelo motor", async () => {
      const { org, callId } = await pronta("agente t4");
      // A organização tem outro cérebro, com chave: ele não é usado.
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolhe(org, CEREBRO.id, COM_PRECO.id);
      await comCerebro(org, "anthropic", [{ id: "claude-sonnet-com-preco", label: "Sonnet", price: PRECO }], false);
      await escolheNoAgente(callId, { kind: "brain", brain: "anthropic", model: "claude-sonnet-com-preco" });
      const calls = CEREBRO.completeJson.mock.calls.length;
      const fetch = openai(completa());

      await roda(org, callId, fetch);

      expect(fetch).not.toHaveBeenCalled();
      expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
      const evento = { reason: "brain_no_key", brain: "anthropic", model: "claude-sonnet-com-preco", choiceFrom: "agent" };
      expect(await falhasDe(callId)).toEqual([evento]);
      expect(await eventosDe(callId, "analysis_not_done")).toEqual([evento]);
      expect(await extratoDe(callId)).toEqual([]);
    });

    it("o modelo do agente saiu da lista guardada: brain_unavailable, e a organização não é usada", async () => {
      const { org, callId } = await pronta("agente modelo saiu");
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolhe(org, CEREBRO.id, COM_PRECO.id);
      await escolheNoAgente(callId, { kind: "brain", brain: CEREBRO.id, model: "modelo-que-saiu" });
      const calls = CEREBRO.completeJson.mock.calls.length;
      const fetch = openai(completa());

      await roda(org, callId, fetch);

      expect(fetch).not.toHaveBeenCalled();
      expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
      expect(await falhasDe(callId)).toEqual([{ reason: "brain_unavailable", brain: CEREBRO.id, model: "modelo-que-saiu", choiceFrom: "agent" }]);
    });

    it("F3: o cérebro escolhido pelo agente sumiu da pasta: brain_unavailable, e nada sai, nem pela organização nem pelo motor", async () => {
      const { org, callId } = await pronta("agente cerebro sumiu");
      // A organização tem um cérebro descoberto, com chave e modelo: cair nela leria a ligação por ele.
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolhe(org, CEREBRO.id, COM_PRECO.id);
      // A lista e a chave do cérebro que sumiu continuam salvas: só a pasta dele não existe mais.
      await comCerebro(org, "cerebro-que-sumiu", [COM_PRECO]);
      await escolheNoAgente(callId, { kind: "brain", brain: "cerebro-que-sumiu", model: COM_PRECO.id });
      const calls = CEREBRO.completeJson.mock.calls.length;
      const fetch = openai(completa());

      await roda(org, callId, fetch);

      // Nem o motor (o `fetch` do caminho do motor) nem o cérebro da organização recebem pedido.
      expect(fetch).not.toHaveBeenCalled();
      expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
      const evento = { reason: "brain_unavailable", brain: "cerebro-que-sumiu", model: COM_PRECO.id, choiceFrom: "agent" };
      expect(await falhasDe(callId)).toEqual([evento]);
      expect(await eventosDe(callId, "analysis_not_done")).toEqual([evento]);
      expect(await extratoDe(callId)).toEqual([]);
      expect(await eventosDe(callId, "call_analyzed")).toEqual([]);
    });

    it.each([
      ["sem o kind", { brain: "cerebro-falso", model: "modelo-com-preco" }],
      ["um kind desconhecido", { kind: "organization" }],
      ["cérebro sem o modelo", { kind: "brain", brain: "cerebro-falso" }],
      ["o motor com um campo a mais", { kind: "engine", brain: "cerebro-falso" }],
      ["um texto solto", "engine"],
      ["uma lista", [null]],
      ["o null do JSON (não o nulo da coluna)", null],
    ])("T5: a coluna fora da forma (%s, gravada à mão) é brain_unavailable, sem cair na organização nem no motor", async (_caso, valor) => {
      const { org, callId } = await pronta(`agente t5 ${JSON.stringify(valor)}`);
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolhe(org, CEREBRO.id, COM_PRECO.id);
      await escolheNoAgente(callId, valor);
      const calls = CEREBRO.completeJson.mock.calls.length;
      const fetch = openai(completa());

      await roda(org, callId, fetch);

      expect(fetch).not.toHaveBeenCalled();
      expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
      const evento = { reason: "brain_unavailable", brain: null, model: null, choiceFrom: "agent" };
      expect(await falhasDe(callId)).toEqual([evento]);
      expect(await eventosDe(callId, "analysis_not_done")).toEqual([evento]);
      expect(await extratoDe(callId)).toEqual([]);
    });

    it("T6: modelo sem preço no agente sem teto é recusado; no agente com teto, é lido com o custo não medido", async () => {
      const semTetoLigacao = await pronta("agente t6 sem teto");
      await semTeto(semTetoLigacao.org);
      await comCerebro(semTetoLigacao.org, CEREBRO.id, [SEM_PRECO]);
      await escolheNoAgente(semTetoLigacao.callId, { kind: "brain", brain: CEREBRO.id, model: SEM_PRECO.id });
      const calls = CEREBRO.completeJson.mock.calls.length;

      await roda(semTetoLigacao.org, semTetoLigacao.callId, openai(completa()));

      expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
      expect(await falhasDe(semTetoLigacao.callId)).toEqual([{ reason: "brain_unmeasured_without_ceiling", brain: CEREBRO.id, model: SEM_PRECO.id, choiceFrom: "agent" }]);

      const comTeto = await pronta("agente t6 com teto");
      await comCerebro(comTeto.org, CEREBRO.id, [SEM_PRECO]);
      await escolheNoAgente(comTeto.callId, { kind: "brain", brain: CEREBRO.id, model: SEM_PRECO.id });
      cerebroEcoa();

      await roda(comTeto.org, comTeto.callId, openai(completa()));

      expect(await extratoDe(comTeto.callId)).toEqual([{ engine: `brain:${CEREBRO.id}`, model: SEM_PRECO.id, cost_measured: false, input_tokens: 1000, output_tokens: 100, cost_microcents: 0 }]);
      expect((await eventosDe(comTeto.callId, "call_analyzed"))[0]).toMatchObject({ costCents: 0, costMeasured: false, choiceFrom: "agent" });
    });

    it("no teto do agente, a escolha do agente também não é chamada", async () => {
      const { org, callId } = await pronta("agente no teto");
      await withSystem(app, (q) => q.exec("update calls set cost_cents = 500 where id = $1", [callId]));
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolheNoAgente(callId, { kind: "brain", brain: CEREBRO.id, model: COM_PRECO.id });
      const calls = CEREBRO.completeJson.mock.calls.length;

      await roda(org, callId, openai(completa()));

      expect(CEREBRO.completeJson.mock.calls.length).toBe(calls);
      expect(await falhasDe(callId)).toEqual([{ reason: "cost_ceiling", brain: CEREBRO.id, model: COM_PRECO.id, choiceFrom: "agent", costCents: 500, ceilingCents: 500 }]);
    });

    it("falha do provedor na escolha do agente: o evento diz que a escolha era do agente", async () => {
      const { org, callId } = await pronta("agente falha provedor");
      await comCerebro(org, CEREBRO.id, [COM_PRECO]);
      await escolheNoAgente(callId, { kind: "brain", brain: CEREBRO.id, model: COM_PRECO.id });
      CEREBRO.completeJson.mockResolvedValueOnce({ ok: false, failure: "rejected", status: 401, model: COM_PRECO.id, usage: {} });

      await roda(org, callId, openai(completa()));

      expect(await falhasDe(callId)).toEqual([{ reason: "rejected", brain: CEREBRO.id, model: COM_PRECO.id, status: 401, costCents: 0, costMeasured: true, choiceFrom: "agent" }]);
    });
  });
});
