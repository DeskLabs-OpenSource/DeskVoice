import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { encryptSecret, recordingPath, withOrg } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NOW, call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { POST } from "./calls/[id]/transcription/route";

const panel = startPanel();
afterAll(() => panel.close());

const CALLER = "Oi, preciso remarcar a consulta de quinta.";
const AGENT = "Claro, posso remarcar para sexta às dez.";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** WAV PCM16 estéreo a 8 kHz, como o gravador escreve: esquerdo é quem ligou, direito é o agente. */
function stereoWav(options: { seconds?: number; caller?: boolean; agent?: boolean } = {}): Buffer {
  const frames = Math.round((options.seconds ?? 1) * 8000);
  const data = Buffer.alloc(frames * 4);
  for (let frame = 0; frame < frames; frame += 1) {
    if (options.caller !== false) data.writeInt16LE(1000, frame * 4);
    if (options.agent !== false) data.writeInt16LE(-1000, frame * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

interface Seed {
  engine?: "openai-realtime" | "gemini-live";
  enabled?: boolean;
  withKey?: boolean;
  audio?: Buffer | null;
  startedAt?: Date;
  costCents?: number;
  ceilingCents?: number;
}

async function seed(org: string, options: Seed = {}): Promise<string> {
  const engine = options.engine ?? "openai-realtime";
  const agentId = await insert(panel.app, org, "insert into agents (organization_id, name, engine, cost_ceiling_cents) values ($1, 'Recepção', $2, $3) returning id", [
    org,
    engine,
    options.ceilingCents ?? 500,
  ]);
  const startedAt = options.startedAt ?? new Date(NOW.getTime() - HOUR_MS);
  const callId = await insert(
    panel.app,
    org,
    `insert into calls (organization_id, agent_id, direction, channel, from_e164, status, engine, started_at, ended_at, cost_cents)
     values ($1, $2, 'inbound', 'phone', '+5511988887777', 'completed', $3, $4, $5, $6) returning id`,
    [org, agentId, engine, startedAt, new Date(startedAt.getTime() + 60_000), options.costCents ?? 0],
  );
  await withOrg(panel.app, org, async (q) => {
    if (options.enabled !== false) await q.exec("insert into settings (organization_id, key, value) values ($1, 'calls.transcription_enabled', 'true')", [org]);
    if (options.withKey !== false) {
      await q.exec("insert into settings (organization_id, key, value) values ($1, $2, to_jsonb($3::text))", [org, `engine.${engine}.api_key`, encryptSecret("sk-de-teste", panel.deps.secretKey)]);
    }
  });
  if (options.audio !== null) {
    const file = recordingPath(panel.deps.recordingsDir, org, callId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, options.audio ?? stereoWav());
  }
  return callId;
}

const post = (cookie: string, id: string) => call(POST, { method: "POST", cookie, params: { id } });

const transcripts = (org: string, callId: string) =>
  withOrg(panel.app, org, (q) =>
    q.many<{ kind: string; at: Date; payload: Record<string, unknown> }>("select kind, at, payload from call_events where call_id = $1 and kind in ('transcript_user', 'transcript_agent') order by id", [callId]),
  );

/** O provedor da OpenAI responde um lado por pedido, na ordem: quem ligou, depois o agente. */
function openaiAnswers(): void {
  const texts = [CALLER, AGENT];
  panel.voice.respond = async () =>
    Response.json({ text: texts.shift() ?? "", usage: { type: "tokens", input_tokens: 100_000, output_tokens: 20_000, total_tokens: 120_000 } });
}

beforeEach(() => {
  panel.voice.requests.length = 0;
  panel.voice.respond = () => {
    throw new Error("the provider should not be called");
  };
});

async function owner(label: string): Promise<{ org: string; cookie: string }> {
  const org = await createOrganization(panel.app, label);
  return { org, cookie: (await createUser(panel.app, org, "owner")).cookie };
}

describe("transcrição da gravação", () => {
  it("transcreve cada lado com o seu dono, cobra no extrato e no custo da chamada, e não chama o provedor duas vezes", async () => {
    const { org, cookie } = await owner("transcribe both sides");
    const callId = await seed(org);
    openaiAnswers();

    const first = await post(cookie, callId);
    expect(first.status).toBe(200);
    expect(first.data).toEqual({ cached: false, turns: [{ speaker: "user", text: CALLER }, { speaker: "agent", text: AGENT }] });
    expect(panel.voice.requests.map((request) => request.url)).toEqual(["https://api.openai.com/v1/audio/transcriptions", "https://api.openai.com/v1/audio/transcriptions"]);

    const events = await transcripts(org, callId);
    expect(events.map((event) => [event.kind, event.payload.text, event.payload.source, event.payload.model])).toEqual([
      ["transcript_user", CALLER, "stt", "gpt-4o-mini-transcribe"],
      ["transcript_agent", AGENT, "stt", "gpt-4o-mini-transcribe"],
    ]);
    // O horário é o do fim da chamada: o prazo de guarda alcança este texto junto com o resto dela.
    expect(events[0]?.at.getTime()).toBe(NOW.getTime() - HOUR_MS + 60_000);

    // Por lado: 100 mil tokens de entrada a US$ 1,25/M (12,5 ¢) e 20 mil de saída a US$ 5/M (10 ¢) = 23 ¢.
    const ledger = await withOrg(panel.app, org, (q) => q.many<{ engine: string; input_tokens: number; output_tokens: number; cost_cents: number }>("select engine, input_tokens, output_tokens, cost_cents from usage_ledger where call_id = $1", [callId]));
    expect(ledger).toEqual([{ engine: "openai-realtime", input_tokens: 200_000, output_tokens: 40_000, cost_cents: 46 }]);
    const cost = await withOrg(panel.app, org, (q) => q.one<{ cost_cents: number }>("select cost_cents from calls where id = $1", [callId]));
    expect(cost?.cost_cents).toBe(46);
    // O resumo, feito sem fala nenhuma, é refeito com o texto novo.
    const queued = await withOrg(panel.app, org, (q) => q.many("select 1 from tasks where call_id = $1 and kind = 'summarize_call'", [callId]));
    expect(queued).toHaveLength(1);

    const second = await post(cookie, callId);
    expect(second.data).toEqual({ cached: true, turns: [{ speaker: "user", text: CALLER }, { speaker: "agent", text: AGENT }] });
    expect(panel.voice.requests).toHaveLength(2);
  });

  it("dois pedidos ao mesmo tempo gravam o texto uma vez só: o segundo devolve o do primeiro", async () => {
    const { org, cookie } = await owner("transcribe twice at once");
    const callId = await seed(org, { audio: stereoWav({ agent: false }) });
    panel.voice.respond = async () => Response.json({ text: CALLER });
    const results = await Promise.all([post(cookie, callId), post(cookie, callId)]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results.map((result) => (result.data as { cached: boolean }).cached).sort()).toEqual([false, true]);
    expect((await transcripts(org, callId)).map((event) => event.payload.text)).toEqual([CALLER]);
  });

  it("no Gemini, a chave vai no cabeçalho x-goog-api-key, nunca na URL, e o lado em silêncio não vai ao provedor", async () => {
    const { org, cookie } = await owner("transcribe gemini");
    const callId = await seed(org, { engine: "gemini-live", audio: stereoWav({ agent: false }) });
    const seen: Array<{ url: string; headers: Headers }> = [];
    panel.voice.respond = async (url, init) => {
      seen.push({ url, headers: new Headers(init.headers) });
      return Response.json({ candidates: [{ content: { parts: [{ text: ` ${CALLER} ` }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 } });
    };

    const result = await post(cookie, callId);
    expect(result.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(seen[0]?.url).not.toContain("sk-de-teste");
    expect(seen[0]?.headers.get("x-goog-api-key")).toBe("sk-de-teste");
    const body = panel.voice.requests[0]?.body as { contents: Array<{ parts: Array<{ inlineData?: { mimeType: string } }> }> };
    expect(body.contents[0]?.parts[0]?.inlineData?.mimeType).toBe("audio/wav");
    expect((await transcripts(org, callId)).map((event) => [event.kind, event.payload.text, event.payload.source])).toEqual([["transcript_user", CALLER, "stt"]]);
  });

  it("desligada na tela, recusa com 409 e não chama o provedor", async () => {
    const { org, cookie } = await owner("transcribe disabled");
    const callId = await seed(org, { enabled: false });
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([409, "transcription_disabled"]);
    expect(panel.voice.requests).toHaveLength(0);
  });

  it("só dono e administrador pedem: o operador recebe 403", async () => {
    const org = await createOrganization(panel.app, "transcribe operator");
    const operator = await createUser(panel.app, org, "operator");
    const callId = await seed(org);
    const result = await post(operator.cookie, callId);
    expect([result.status, result.code]).toEqual([403, "forbidden"]);
    expect(panel.voice.requests).toHaveLength(0);
  });

  it("chamada que já tem texto recusa com 409", async () => {
    const { org, cookie } = await owner("transcribe has text");
    const callId = await seed(org);
    await withOrg(panel.app, org, (q) => q.exec("insert into call_events (organization_id, call_id, at, kind, payload) values ($1, $2, $3, 'transcript_agent', $4)", [org, callId, NOW, JSON.stringify({ text: "Bom dia." })]));
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([409, "transcription_has_text"]);
    expect(panel.voice.requests).toHaveLength(0);
  });

  it("gravação ainda guardada de uma chamada mais antiga que o prazo da transcrição não ganha texto", async () => {
    const { org, cookie } = await owner("transcribe outside retention");
    const callId = await seed(org, { startedAt: new Date(NOW.getTime() - 31 * DAY_MS) });
    await withOrg(panel.app, org, (q) => q.exec("insert into settings (organization_id, key, value) values ($1, 'transcripts.retention_days', '30')", [org]));
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([409, "transcription_outside_retention"]);
    expect(panel.voice.requests).toHaveLength(0);
    expect(await transcripts(org, callId)).toEqual([]);
  });

  it("chamada apagada a pedido do titular recusa com 409", async () => {
    const { org, cookie } = await owner("transcribe erased");
    const callId = await seed(org);
    await withOrg(panel.app, org, (q) => q.exec("update calls set erased_at = $2 where id = $1", [callId, NOW]));
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([409, "transcription_call_erased"]);
    expect(panel.voice.requests).toHaveLength(0);
  });

  it("apagamento que confirma enquanto o provedor responde alcança a escrita: nenhum texto, e o gasto fica no extrato", async () => {
    const { org, cookie } = await owner("transcribe erased midway");
    const callId = await seed(org, { audio: stereoWav({ agent: false }) });
    panel.voice.respond = async () => {
      await withOrg(panel.app, org, (q) => q.exec("update calls set erased_at = $2 where id = $1", [callId, NOW]));
      return Response.json({ text: CALLER, usage: { type: "tokens", input_tokens: 100_000, output_tokens: 20_000, total_tokens: 120_000 } });
    };
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([409, "transcription_call_erased"]);
    expect(await transcripts(org, callId)).toEqual([]);
    const ledger = await withOrg(panel.app, org, (q) => q.many<{ cost_cents: number }>("select cost_cents from usage_ledger where call_id = $1", [callId]));
    expect(ledger).toEqual([{ cost_cents: 23 }]);
  });

  it("chamada que já atingiu o teto de custo do agente recusa sem chamar o provedor", async () => {
    const { org, cookie } = await owner("transcribe ceiling");
    const callId = await seed(org, { costCents: 500, ceilingCents: 500 });
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([409, "transcription_cost_ceiling"]);
    expect(panel.voice.requests).toHaveLength(0);
  });

  it("gravação mais longa que o provedor aceita num pedido recusa com 409, sem enviar nada", async () => {
    const { org, cookie } = await owner("transcribe too long");
    // Gemini aceita cerca de 14,9 MB por lado (20 MB por pedido, em base64): 16 minutos passam do limite.
    const callId = await seed(org, { engine: "gemini-live", audio: stereoWav({ seconds: 16 * 60, caller: false, agent: false }) });
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([409, "transcription_too_long"]);
    expect(panel.voice.requests).toHaveLength(0);
  });

  it("sem chave do motor, recusa dizendo o que falta", async () => {
    const { org, cookie } = await owner("transcribe no key");
    const callId = await seed(org, { withKey: false });
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([409, "engine_not_configured"]);
    expect(panel.voice.requests).toHaveLength(0);
  });

  it("sem gravação, 404 com código próprio", async () => {
    const { org, cookie } = await owner("transcribe no audio");
    const callId = await seed(org, { audio: null });
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([404, "transcription_no_recording"]);
  });

  it("provedor que recusa vira 502, sem texto na linha do tempo", async () => {
    const { org, cookie } = await owner("transcribe provider down");
    const callId = await seed(org, { audio: stereoWav({ agent: false }) });
    panel.voice.respond = async () => Response.json({ error: { message: "boom" } }, { status: 500 });
    const result = await post(cookie, callId);
    expect([result.status, result.code]).toEqual([502, "transcription_failed"]);
    expect(await transcripts(org, callId)).toEqual([]);
  });
});
