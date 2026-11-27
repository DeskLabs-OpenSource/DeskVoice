import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_TASK_ATTEMPTS, encryptSecret, recordEvent, withOrg, withSystem } from "@deskvoice/core";
import { AUTO_TRANSCRIPTION_SETTING, TRANSCRIPTION_SETTING, type VoiceEngine } from "@deskvoice/voice-engine";
import type * as VoiceEngineModule from "@deskvoice/voice-engine";
import type * as FsPromises from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCall, createOrganization, depsFor, eventsOf, openTestDbs, t0, task } from "../../test/helpers";
import transcribeCall from "./transcribe_call";

/** O provedor, interceptado: o que se prova aqui é a rotina — quem fala com a rede é o motor. */
const PROVEDOR = vi.hoisted(() => ({
  id: "falso-transcreve",
  /** O limite de um pedido do provedor; um teste o baixa para a gravação não caber. */
  maxAudioBytes: 25 * 1024 * 1024,
  transcribe: vi.fn(async (_key: string, input: { seconds: number }) => ({
    ok: true as const,
    text: `fala de ${input.seconds}s`,
    model: "falso-stt",
    usage: { seconds: input.seconds },
    costCents: 1,
  })),
}));

// O mesmo id do motor falso: a factory do `vi.mock` é elevada, então só pode ler o que está no `vi.hoisted`.
const MOTOR = PROVEDOR.id;
vi.mock("@deskvoice/voice-engine", async (importOriginal) => {
  const real = await importOriginal<typeof VoiceEngineModule>();
  const engine = {
    id: PROVEDOR.id,
    label: "Falso",
    provider: "falso",
    processingLocation: "neste-servidor",
    pricing: { inputPerMillionCents: 0, outputPerMillionCents: 0 },
    transcription: {
      model: "falso-stt",
      pricing: { inputPerMillionCents: 0, outputPerMillionCents: 0 },
      get maxAudioBytes() {
        return PROVEDOR.maxAudioBytes;
      },
      transcribe: PROVEDOR.transcribe,
    },
  } as unknown as VoiceEngine;
  return {
    ...real,
    loadEngines: async (...args: Parameters<typeof real.loadEngines>) => (await real.loadEngines(...args)).set(PROVEDOR.id, engine),
  };
});

const { app, owner } = openTestDbs();
const secretKey = depsFor(app).secretKey;

afterAll(async () => {
  await app.close();
  await owner.close();
});

// `readFile` espiado: o que se prova é que a gravação longa demais nem é lida.
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof FsPromises>();
  return { ...real, readFile: vi.fn(real.readFile) };
});

beforeEach(() => {
  PROVEDOR.transcribe.mockClear();
  PROVEDOR.maxAudioBytes = 25 * 1024 * 1024;
  vi.mocked(readFile).mockClear();
});

/**
 * O WAV que o gravador escreve: PCM16 estéreo a 8 kHz, com quem ligou à esquerda e o agente à
 * direita. `splitRecording` recusa qualquer outro formato — e é bom que recuse.
 */
function wavEstereo(frames: number): Buffer {
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(1200, i * 4);
    data.writeInt16LE(-1200, i * 4 + 2);
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
  header.writeUInt32LE(8000 * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const comAgente = async (label: string): Promise<{ org: string; callId: string }> => {
  const org = await createOrganization(app, label);
  const agentId = await withSystem(app, async (q) => {
    const row = await q.one<{ id: string }>("insert into agents (organization_id, name, engine) values ($1, 'Recepção', $2) returning id", [org, MOTOR]);
    return row?.id as string;
  });
  const callId = await createCall(app, org, t0);
  await withSystem(app, (q) => q.exec("update calls set agent_id = $2, ended_at = $3 where id = $1", [callId, agentId, t0]));
  return { org, callId };
};

/** As duas chaves: a licença do áudio sair (`calls.transcription_enabled`) e a automática. */
const ligarChaves = (org: string, keys = [TRANSCRIPTION_SETTING, AUTO_TRANSCRIPTION_SETTING]): Promise<unknown> =>
  withSystem(app, async (q) => {
    for (const key of keys) await q.exec("insert into settings (organization_id, key, value) values ($1, $2, 'true'::jsonb)", [org, key]);
  });

const ligar = async (org: string, keys?: string[]): Promise<unknown> => {
  await ligarChaves(org, keys);
  return withSystem(app, (q) =>
    q.exec("insert into settings (organization_id, key, value) values ($1, $2, to_jsonb($3::text))", [org, `engine.${MOTOR}.api_key`, encryptSecret("sk-de-teste", secretKey)]),
  );
};

/** Grava o arquivo no lugar em que a rotina procura: `<dir>/<org>/<callId>.wav`. */
async function gravar(org: string, callId: string, frames = 8000 * 3): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "transcreve-"));
  await mkdir(path.join(dir, org), { recursive: true });
  await writeFile(path.join(dir, org, `${callId}.wav`), wavEstereo(frames));
  return dir;
}

const rodar = (org: string, callId: string, recordingsDir?: string): Promise<void> =>
  transcribeCall.run(task(org, "transcribe_call", {}, callId), depsFor(app, { recordingsDir, fetch: (async () => new Response("{}")) as unknown as typeof fetch }));

const leuAGravacao = (callId: string): boolean => vi.mocked(readFile).mock.calls.some(([file]) => String(file).endsWith(`${callId}.wav`));

const falas = async (callId: string) =>
  (await eventsOf(app, callId)).filter((event) => event.kind === "transcript_user" || event.kind === "transcript_agent");

const resumos = (org: string, callId: string): Promise<number> =>
  withSystem(app, async (q) => {
    const row = await q.one<{ n: number }>("select count(*)::int as n from tasks where call_id = $1 and kind = 'summarize_call'", [callId]);
    return row?.n ?? 0;
  });

describe("a transcrição automática do fim da chamada", () => {
  it("transcreve os dois lados e deixa o texto na linha do tempo", async () => {
    const { org, callId } = await comAgente("Transcreve");
    await ligar(org);
    const dir = await gravar(org, callId);

    await rodar(org, callId, dir);

    const texto = await falas(callId);
    expect(texto).toHaveLength(2);
    expect(texto.map((event) => event.kind)).toEqual(["transcript_user", "transcript_agent"]);
    expect(texto.every((event) => event.payload.source === "stt")).toBe(true);
    // Um pedido por lado: o provedor não recebe o arquivo estéreo inteiro de uma vez.
    expect(PROVEDOR.transcribe).toHaveBeenCalledTimes(2);
    expect(leuAGravacao(callId)).toBe(true);
    expect(await resumos(org, callId)).toBe(1);
  });

  it("o recado da caixa postal com o agente desligado ganha texto com a chave do agente do número", async () => {
    const { org, callId } = await comAgente("Recado");
    await withSystem(app, async (q) => {
      await q.exec("update agents set enabled = false where organization_id = $1", [org]);
      await q.exec("update calls set voicemail = true, status = 'completed', end_reason = 'voicemail' where id = $1", [callId]);
    });
    await ligar(org);
    // A forma que a caixa postal grava: o aviso no canal do agente e, só depois dele, quem ligou.
    const dir = await gravar(org, callId);
    const wav = await readFile(path.join(dir, org, `${callId}.wav`));
    const aviso = 8000 * 1;
    for (let frame = 0; frame < wav.subarray(44).length / 4; frame += 1) {
      if (frame < aviso) wav.writeInt16LE(0, 44 + frame * 4);
      else wav.writeInt16LE(0, 44 + frame * 4 + 2);
    }
    await writeFile(path.join(dir, org, `${callId}.wav`), wav);

    await rodar(org, callId, dir);

    expect((await falas(callId)).map((event) => event.kind)).toEqual(["transcript_user", "transcript_agent"]);
    expect(PROVEDOR.transcribe).toHaveBeenCalledTimes(2);
    expect(await resumos(org, callId)).toBe(1);
  });

  it("o recado de um número sem agente não tem chave: não fala com o provedor e ainda enfileira o resumo", async () => {
    const org = await createOrganization(app, "Recado sem agente");
    const callId = await createCall(app, org, t0);
    await withSystem(app, (q) => q.exec("update calls set agent_id = null, voicemail = true, status = 'completed', end_reason = 'voicemail', ended_at = $2 where id = $1", [callId, t0]));
    await ligar(org);
    const dir = await gravar(org, callId);

    await rodar(org, callId, dir);

    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
    expect(await falas(callId)).toHaveLength(0);
    expect(await resumos(org, callId)).toBe(1);
  });

  it("desligada de fábrica: não fala com o provedor e ainda enfileira o resumo", async () => {
    const { org, callId } = await comAgente("Desligada");
    const dir = await gravar(org, callId);

    await rodar(org, callId, dir);

    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
    expect(await falas(callId)).toHaveLength(0);
    // O resumo não pode se perder: é ele quem avisa o dono e roda o desfecho.
    expect(await resumos(org, callId)).toBe(1);
  });

  it("sem chave do motor: registra o motivo e não gasta", async () => {
    const { org, callId } = await comAgente("Sem chave");
    await ligarChaves(org);
    const dir = await gravar(org, callId);

    await rodar(org, callId, dir);

    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
    const motivo = (await eventsOf(app, callId)).find((event) => event.kind === "transcription_failed");
    expect(motivo?.payload.reason).toBe("no_key");
  });

  it("no teto de gasto do mês da organização: não lê a gravação, não fala com o provedor, diz por quê e o resumo segue", async () => {
    const { org, callId } = await comAgente("Teto do mês");
    await ligar(org);
    const dir = await gravar(org, callId);
    // Teto de 1 centavo, já gasto por outra ligação do mês: o mesmo `spendCapReached` das portas.
    const outra = await createCall(app, org, t0);
    await withSystem(app, async (q) => {
      await q.exec("insert into organization_limits (organization_id, monthly_spend_cap_cents) values ($1, 1) on conflict (organization_id) do update set monthly_spend_cap_cents = 1", [org]);
      await q.exec("insert into usage_ledger (organization_id, call_id, engine, cost_cents, cost_microcents, at) values ($1, $2, $3, 1, 1000000, $4)", [org, outra, MOTOR, t0]);
    });

    await rodar(org, callId, dir);

    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
    expect(leuAGravacao(callId)).toBe(false);
    const motivo = (await eventsOf(app, callId)).find((event) => event.kind === "transcription_failed");
    expect(motivo?.payload).toEqual({ reason: "spend_cap_reached", engine: MOTOR, capCents: 1 });
    expect(await falas(callId)).toHaveLength(0);
    expect(await resumos(org, callId)).toBe(1);
  });

  it("já transcrita: não paga de novo", async () => {
    const { org, callId } = await comAgente("Repetida");
    await ligar(org);
    const dir = await gravar(org, callId);
    await withOrg(app, org, (q) => recordEvent(q, callId, "transcript_user", { text: "já estava aqui", source: "stt" }, t0));

    await rodar(org, callId, dir);

    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
    expect(await falas(callId)).toHaveLength(1);
  });

  it("só a transcrição a pedido ligada: a automática não age", async () => {
    const { org, callId } = await comAgente("Só manual");
    await ligar(org, [TRANSCRIPTION_SETTING]);
    const dir = await gravar(org, callId);

    await rodar(org, callId, dir);

    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
    expect(await resumos(org, callId)).toBe(1);
  });

  it("só a automática ligada, sem a licença do áudio sair: não age", async () => {
    const { org, callId } = await comAgente("Só automática");
    await ligar(org, [AUTO_TRANSCRIPTION_SETTING]);
    const dir = await gravar(org, callId);

    await rodar(org, callId, dir);

    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
  });

  it("conversa transcrita em tempo real (sem source) e gravada: não paga de novo", async () => {
    const { org, callId } = await comAgente("Tempo real");
    await ligar(org);
    const dir = await gravar(org, callId);
    // O que a sessão de voz grava durante a ligação: só o texto, sem `source`.
    await withOrg(app, org, async (q) => {
      await recordEvent(q, callId, "transcript_agent", { text: "Olá, em que posso ajudar?" }, t0);
      await recordEvent(q, callId, "transcript_user", { text: "Quero remarcar." }, t0);
    });

    await rodar(org, callId, dir);

    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
    expect(await falas(callId)).toHaveLength(2);
    expect(await resumos(org, callId)).toBe(1);
  });

  it("fala vazia não conta como texto: a chamada é transcrita", async () => {
    const { org, callId } = await comAgente("Fala vazia");
    await ligar(org);
    const dir = await gravar(org, callId);
    await withOrg(app, org, (q) => recordEvent(q, callId, "transcript_user", { text: "" }, t0));

    await rodar(org, callId, dir);

    expect(PROVEDOR.transcribe).toHaveBeenCalledTimes(2);
  });

  it("gravação maior que um pedido do provedor: nem é lida, e a linha do tempo diz o motivo", async () => {
    const { org, callId } = await comAgente("Longa demais");
    await ligar(org);
    // Três segundos: 96.044 bytes no arquivo, 48.044 por lado. O limite fica abaixo disso.
    const dir = await gravar(org, callId);
    PROVEDOR.maxAudioBytes = 48_000;

    await rodar(org, callId, dir);

    expect(leuAGravacao(callId)).toBe(false);
    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
    const motivo = (await eventsOf(app, callId)).find((event) => event.kind === "transcription_failed");
    expect(motivo?.payload.reason).toBe("transcription_too_long");
    expect(await resumos(org, callId)).toBe(1);
  });

  it("sem gravação no disco: não é falha, e o resumo segue", async () => {
    const { org, callId } = await comAgente("Sem gravação");
    await ligar(org);

    await rodar(org, callId, await mkdtemp(path.join(tmpdir(), "vazio-")));

    expect(PROVEDOR.transcribe).not.toHaveBeenCalled();
    expect((await eventsOf(app, callId)).some((event) => event.kind === "transcription_failed")).toBe(false);
    expect(await resumos(org, callId)).toBe(1);
  });

  it("falha que esgota as tentativas: na última, o resumo (e o aviso ao dono) sai mesmo sem texto", async () => {
    const { org, callId } = await comAgente("Esgotou");
    await ligar(org);
    const dir = await gravar(org, callId);
    const deps = depsFor(app, { recordingsDir: dir, fetch: (async () => new Response("{}")) as unknown as typeof fetch });
    PROVEDOR.transcribe.mockRejectedValueOnce(new Error("rede caiu")).mockRejectedValueOnce(new Error("rede caiu"));

    // Antes da última tentativa, a fila reexecuta: o resumo esperaria o texto da próxima.
    await expect(transcribeCall.run({ ...task(org, "transcribe_call", {}, callId), attempts: MAX_TASK_ATTEMPTS - 1 }, deps)).rejects.toThrow("rede caiu");
    expect(await resumos(org, callId)).toBe(0);

    // Na última, a falha continua chegando à fila, e o resumo entra mesmo assim.
    await expect(transcribeCall.run({ ...task(org, "transcribe_call", {}, callId), attempts: MAX_TASK_ATTEMPTS }, deps)).rejects.toThrow("rede caiu");
    expect(await resumos(org, callId)).toBe(1);
    expect(await falas(callId)).toHaveLength(0);
  });
});
