import { parseRecordedSpeech, withOrg } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { DELETE as deleteAgent } from "./agents/[id]/route";
import { GET as getAudio, PUT as putAudio } from "./ivr-menus/[id]/audio/route";
import { PUT as putOptions } from "./ivr-menus/[id]/options/route";
import { DELETE as deleteMenu, GET as getMenu, PATCH as patchMenu } from "./ivr-menus/[id]/route";
import { GET as listMenus, POST as createMenu } from "./ivr-menus/route";
import { PATCH as patchNumber } from "./phone-numbers/[id]/route";
import { GET as listNumbers, POST as createNumber } from "./phone-numbers/route";

/**
 * O menu por teclas no painel (URA fatia 1b, T11 do desenho da DESA-160): a API recusa o menu sem
 * uma tecla para uma pessoa, o número em `ivr` com menu sem anúncio, o anúncio em outro formato ou
 * com mais de 60 s e o agente usado por uma tecla ao ser apagado. E nenhuma organização lê ou mexe
 * no menu de outra pela API.
 */
const panel = startPanel();
let org: string;
let owner: string;
let operator: string;
let trunk: string;

const PERSON = { digit: "9", label: "Recepção", action: "transfer", transferTo: "(31) 3222-1100" };

beforeAll(async () => {
  org = await createOrganization(panel.app, "ivr panel");
  owner = (await createUser(panel.app, org, "owner")).cookie;
  operator = (await createUser(panel.app, org, "operator")).cookie;
  trunk = await insert(panel.app, org, "insert into trunks (organization_id, name, host, auth_mode) values ($1, 'Linha', '203.0.113.70', 'ip') returning id", [org]);
});
afterAll(() => panel.close());

const stored = (sql: string, params: unknown[] = []) => withOrg(panel.app, org, (q) => q.one<Record<string, unknown>>(sql, params));

/** Um WAV com o formato pedido e `samples` amostras (silêncio). */
function wav(options: { rate?: number; channels?: number; bits?: number; samples?: number } = {}): Buffer {
  const rate = options.rate ?? 8000;
  const channels = options.channels ?? 1;
  const bits = options.bits ?? 16;
  const data = Buffer.alloc((options.samples ?? 8000) * channels * (bits / 8));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * (bits / 8), 28);
  header.writeUInt16LE(channels * (bits / 8), 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function upload(id: string, body: Buffer, options: { cookie?: string; type?: string } = {}) {
  const request = new Request("https://panel.test/api/v1/x", {
    method: "PUT",
    headers: { cookie: options.cookie ?? owner, "content-type": options.type ?? "audio/wav" },
    body: new Uint8Array(body),
  });
  const response = await putAudio(request, { params: Promise.resolve({ id }) });
  const json = (await response.json()) as { ok: boolean; data?: { promptAudioMs: number }; error?: { code: string; message: string } };
  return { status: response.status, data: json.data, code: json.error?.code, message: json.error?.message };
}

async function listen(id: string, cookie = owner): Promise<{ status: number; body: Buffer; type: string | null }> {
  const response = await getAudio(new Request("https://panel.test/api/v1/x", { headers: { cookie } }), { params: Promise.resolve({ id }) });
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()), type: response.headers.get("content-type") };
}

async function newMenu(name: string, options: unknown[] = [PERSON]): Promise<string> {
  const created = await call(createMenu, { method: "POST", cookie: owner, body: { name, options } });
  expect(created.status).toBe(200);
  return (created.data as { id: string }).id;
}

async function newAgent(name: string): Promise<string> {
  return insert(panel.app, org, "insert into agents (organization_id, name, engine) values ($1, $2, 'simulated') returning id", [org, name]);
}

let numberSeq = 0;
async function newNumber(): Promise<string> {
  numberSeq += 1;
  const created = await call(createNumber, { method: "POST", cookie: owner, body: { trunkId: trunk, number: `(31) 98000-00${String(numberSeq).padStart(2, "0")}` } });
  expect(created.status).toBe(200);
  return (created.data as { id: string }).id;
}

/** Alguém do banco espera uma trava numa consulta que contém `text`. */
async function someoneWaitsOn(text: string, timeoutMs = 3000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const waiting = await withOrg(panel.app, org, (q) =>
      q.one<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and position($1 in query) > 0", [text]),
    );
    if ((waiting?.n ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

describe("T11: o menu sem tecla para uma pessoa", () => {
  it("não nasce: a criação recusa, e nada fica gravado", async () => {
    const refused = await call(createMenu, { method: "POST", cookie: owner, body: { name: "Sem saída", options: [{ digit: "1", label: "Sair", action: "hangup" }] } });
    expect([refused.status, refused.code]).toEqual([400, "ivr_no_person_exit"]);
    const empty = await call(createMenu, { method: "POST", cookie: owner, body: { name: "Sem saída", options: [] } });
    expect([empty.status, empty.code]).toEqual([400, "ivr_no_person_exit"]);
    expect(await stored("select count(*)::int as n from ivr_menus where name = 'Sem saída'")).toEqual({ n: 0 });
  });

  it("não perde a tecla da pessoa: trocar as teclas por um conjunto sem `transfer` é recusado, e as de antes ficam", async () => {
    const agent = await newAgent("Agente da troca");
    const id = await newMenu("Troca", [PERSON, { digit: "1", label: "IA", action: "agent", agentId: agent }]);
    const refused = await call(putOptions, { method: "PUT", cookie: owner, params: { id }, body: [{ digit: "1", label: "IA", action: "agent", agentId: agent }] });
    expect([refused.status, refused.code]).toEqual([400, "ivr_no_person_exit"]);
    const kept = await call(getMenu, { cookie: owner, params: { id } });
    expect((kept.data as { options: unknown[] }).options).toEqual([
      { digit: "1", label: "IA", action: "agent", agentId: agent, transferTo: null },
      { digit: "9", label: "Recepção", action: "transfer", agentId: null, transferTo: "+553132221100" },
    ]);
  });

  it("recusa a mesma tecla duas vezes e a ação sem o campo dela", async () => {
    const twice = await call(createMenu, { method: "POST", cookie: owner, body: { name: "Repetida", options: [PERSON, { ...PERSON, label: "Outra" }] } });
    expect([twice.status, twice.code]).toEqual([400, "validation_error"]);
    const noNumber = await call(createMenu, { method: "POST", cookie: owner, body: { name: "Sem número", options: [{ digit: "1", label: "Pessoa", action: "transfer" }] } });
    expect([noNumber.status, noNumber.code]).toEqual([400, "validation_error"]);
  });
});

describe("T11: o número em `ivr`", () => {
  it("nasce em `ai`, e não vai para um menu sem anúncio", async () => {
    const number = await newNumber();
    expect(await stored("select mode, ivr_menu_id from phone_numbers where id = $1", [number])).toEqual({ mode: "ai", ivr_menu_id: null });
    const menu = await newMenu("Sem anúncio");
    const refused = await call(patchNumber, { method: "PATCH", cookie: owner, params: { id: number }, body: { mode: "ivr", ivrMenuId: menu } });
    expect([refused.status, refused.code]).toEqual([400, "ivr_menu_no_prompt"]);
    expect(await stored("select mode, ivr_menu_id from phone_numbers where id = $1", [number])).toEqual({ mode: "ai", ivr_menu_id: null });
  });

  it("não vai para um menu que, mesmo com anúncio, não leva a uma pessoa (gravado por fora da API)", async () => {
    const number = await newNumber();
    const menu = await newMenu("Perdeu a pessoa");
    expect((await upload(menu, wav())).status).toBe(200);
    await withOrg(panel.app, org, (q) => q.exec("update ivr_options set action = 'hangup', transfer_e164 = null where menu_id = $1", [menu]));
    const refused = await call(patchNumber, { method: "PATCH", cookie: owner, params: { id: number }, body: { mode: "ivr", ivrMenuId: menu } });
    expect([refused.status, refused.code]).toEqual([400, "ivr_no_person_exit"]);
    expect(await stored("select mode from phone_numbers where id = $1", [number])).toEqual({ mode: "ai" });
  });

  it("não fica em `ivr` sem menu", async () => {
    const number = await newNumber();
    const refused = await call(patchNumber, { method: "PATCH", cookie: owner, params: { id: number }, body: { mode: "ivr" } });
    expect([refused.status, refused.code]).toEqual([400, "ivr_menu_required"]);
  });

  it("vai para o menu pronto, aparece assim na lista, e volta para `ai` soltando o menu", async () => {
    const number = await newNumber();
    const menu = await newMenu("Pronto");
    await upload(menu, wav());
    const saved = await call(patchNumber, { method: "PATCH", cookie: owner, params: { id: number }, body: { mode: "ivr", ivrMenuId: menu } });
    expect(saved.data).toMatchObject({ mode: "ivr", ivrMenuId: menu });
    expect((await call(listNumbers, { cookie: owner })).data).toContainEqual(expect.objectContaining({ id: number, mode: "ivr", ivrMenuId: menu }));
    const back = await call(patchNumber, { method: "PATCH", cookie: owner, params: { id: number }, body: { mode: "ai" } });
    expect(back.data).toMatchObject({ mode: "ai", ivrMenuId: null });
  });
});

describe("T11: o anúncio", () => {
  it("guarda o PCM do WAV certo, e o Ouvir devolve o mesmo áudio; a lista nunca leva o áudio", async () => {
    const menu = await newMenu("Ouvir");
    const original = wav({ samples: 8000 });
    original.writeInt16LE(1234, 44);
    const pcm = Buffer.from(original.subarray(44));
    const saved = await upload(menu, original);
    expect([saved.status, saved.data]).toEqual([200, { id: menu, promptAudioMs: 1000 }]);
    const heard = await listen(menu);
    expect([heard.status, heard.type]).toEqual([200, "audio/wav"]);
    expect(parseRecordedSpeech(heard.body, "ouvido")).toEqual(pcm);
    const list = await call(listMenus, { cookie: owner });
    expect(list.text).not.toMatch(/"prompt_?audio"\s*:/i);
    expect(list.data).toContainEqual(expect.objectContaining({ id: menu, promptAudioMs: 1000 }));
    expect(Object.keys((list.data as Array<Record<string, unknown>>)[0] ?? {}).sort()).toEqual(
      ["createdAt", "id", "language", "maxAttempts", "name", "onNoChoice", "options", "promptAudioMs", "timeoutMs", "updatedAt"].sort(),
    );
  });

  it("recusa o WAV em outro formato, com o formato esperado, e o anúncio não muda", async () => {
    const menu = await newMenu("Formato");
    for (const wrong of [wav({ rate: 16_000 }), wav({ channels: 2 }), wav({ bits: 8 }), Buffer.from("ID3\u0004\u0000\u0000 not a wav, an mp3")]) {
      const refused = await upload(menu, wrong);
      expect([refused.status, refused.code]).toEqual([400, "ivr_prompt_format"]);
      expect(refused.message).toContain("PCM 16 bits, mono, 8000 Hz");
    }
    const notWav = await upload(menu, wav(), { type: "audio/mpeg" });
    expect([notWav.status, notWav.code]).toEqual([415, "ivr_prompt_format"]);
    expect(await stored("select prompt_audio, prompt_audio_ms from ivr_menus where id = $1", [menu])).toEqual({ prompt_audio: null, prompt_audio_ms: null });
  });

  it("recusa o anúncio com mais de 60 s e o corpo com mais de 1 MiB, e aceita os 60 s exatos", async () => {
    const menu = await newMenu("Comprido");
    const long = await upload(menu, wav({ samples: 60 * 8000 + 8 }));
    expect([long.status, long.code]).toEqual([400, "ivr_prompt_too_long"]);
    // 480 001 e 480 003 amostras são 60 000,125 ms e 60 000,375 ms, que arredondados dariam 60 000 e
    // passariam (ajuste 1 da fatia 1e: o máximo compara antes de arredondar).
    for (const samples of [60 * 8000 + 1, 60 * 8000 + 3]) {
      const over = await upload(menu, wav({ samples }));
      expect([over.status, over.code]).toEqual([400, "ivr_prompt_too_long"]);
    }
    const huge = await upload(menu, Buffer.concat([wav({ samples: 0 }), Buffer.alloc(1024 * 1024)]));
    expect([huge.status, huge.code]).toEqual([413, "ivr_prompt_too_large"]);
    expect(await stored("select prompt_audio_ms from ivr_menus where id = $1", [menu])).toEqual({ prompt_audio_ms: null });
    const exact = await upload(menu, wav({ samples: 60 * 8000 }));
    expect([exact.status, exact.data?.promptAudioMs]).toEqual([200, 60_000]);
  });

  it("U12: recusa o anúncio com menos de 200 ms (`ivr_prompt_too_short`), e aceita os 200 ms exatos", async () => {
    const menu = await newMenu("Curto");
    // 199 ms: 1592 amostras a 8 kHz. 1599 amostras são 199,875 ms, que arredondados dariam 200 (fatia
    // 1e: a rota compara antes de arredondar). Um WAV de uma amostra (o arquivo mudo que a tela já
    // recusa) também.
    for (const [samples, ms] of [
      [1592, 199],
      [1599, 199],
      [1, 0],
    ] as const) {
      const short = await upload(menu, wav({ samples }));
      expect([short.status, short.code, short.message]).toEqual([400, "ivr_prompt_too_short", `The announcement lasts ${ms} ms; it must last at least 200 ms.`]);
    }
    expect(await stored("select prompt_audio, prompt_audio_ms from ivr_menus where id = $1", [menu])).toEqual({ prompt_audio: null, prompt_audio_ms: null });
    const exact = await upload(menu, wav({ samples: 1600 }));
    expect([exact.status, exact.data?.promptAudioMs]).toEqual([200, 200]);
  });

  it("P3: o `GET` de um menu não devolve os bytes do anúncio, só `promptAudioMs`", async () => {
    const menu = await newMenu("Sem bytes");
    expect((await upload(menu, wav({ samples: 8000 }))).status).toBe(200);
    const read = await call(getMenu, { cookie: owner, params: { id: menu } });
    expect(read.status).toBe(200);
    expect(read.text).not.toMatch(/"prompt_?audio"\s*:/i);
    expect(read.data).toMatchObject({ id: menu, promptAudioMs: 1000 });
    expect(Object.keys(read.data as Record<string, unknown>).sort()).toEqual(
      ["createdAt", "id", "language", "maxAttempts", "name", "onNoChoice", "options", "promptAudioMs", "timeoutMs", "updatedAt"].sort(),
    );
  });

  it("só quem configura sobe o anúncio", async () => {
    const menu = await newMenu("Papel");
    const refused = await upload(menu, wav(), { cookie: operator });
    expect([refused.status, refused.code]).toEqual([403, "forbidden"]);
    expect((await listen(menu, operator)).status).toBe(404);
  });
});

describe("T11: o que está em uso não some", () => {
  it("o agente de uma tecla não é apagado: o erro diz o menu, e depois de trocar a tecla ele sai", async () => {
    const agent = await newAgent("Financeiro IA");
    const menu = await newMenu("Menu do financeiro", [PERSON, { digit: "2", label: "Financeiro", action: "agent", agentId: agent }]);
    const refused = await call(deleteAgent, { method: "DELETE", cookie: owner, params: { id: agent } });
    expect([refused.status, refused.code, refused.message]).toEqual([409, "agent_in_ivr_menu", "Menu do financeiro"]);
    expect(await stored("select name from agents where id = $1", [agent])).toEqual({ name: "Financeiro IA" });
    await call(putOptions, { method: "PUT", cookie: owner, params: { id: menu }, body: [PERSON] });
    expect((await call(deleteAgent, { method: "DELETE", cookie: owner, params: { id: agent } })).status).toBe(200);
  });

  it("a tecla gravada entre a conferência e o apagamento do agente dá a mesma recusa, com o menu, e não um erro cru", async () => {
    const agent = await newAgent("Agente da corrida");
    const menu = await newMenu("Menu da corrida");
    let release: () => void = () => undefined;
    let wrote: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const didWrite = new Promise<void>((resolve) => (wrote = resolve));
    // Outra transação põe o agente numa tecla e ainda não confirmou: a conferência da rota não a vê.
    const saving = withOrg(panel.app, org, async (q) => {
      await q.exec("insert into ivr_options (organization_id, menu_id, digit, label, action, agent_id) values ($1, $2, '3', 'Corrida', 'agent', $3)", [org, menu, agent]);
      wrote();
      await held;
    });
    await didWrite;
    const deleting = call(deleteAgent, { method: "DELETE", cookie: owner, params: { id: agent } });
    try {
      expect(await someoneWaitsOn("delete from agents")).toBe(true);
    } finally {
      release();
    }
    await saving;
    const refused = await deleting;
    expect([refused.status, refused.code, refused.message]).toEqual([409, "agent_in_ivr_menu", "Menu da corrida"]);
    expect(await stored("select name from agents where id = $1", [agent])).toEqual({ name: "Agente da corrida" });
  });

  it("o menu que atende um número não é apagado: o erro diz o número; o menu solto sai", async () => {
    const number = await newNumber();
    const menu = await newMenu("Em uso");
    await upload(menu, wav());
    await call(patchNumber, { method: "PATCH", cookie: owner, params: { id: number }, body: { mode: "ivr", ivrMenuId: menu } });
    const e164 = (await stored("select e164 from phone_numbers where id = $1", [number]))?.e164;
    const refused = await call(deleteMenu, { method: "DELETE", cookie: owner, params: { id: menu } });
    expect([refused.status, refused.code, refused.message]).toEqual([409, "ivr_menu_in_use", e164]);
    await call(patchNumber, { method: "PATCH", cookie: owner, params: { id: number }, body: { mode: "ai" } });
    expect((await call(deleteMenu, { method: "DELETE", cookie: owner, params: { id: menu } })).status).toBe(200);
    expect(await stored("select count(*)::int as n from ivr_menus where id = $1", [menu])).toEqual({ n: 0 });
  });
});

describe("o editor do menu", () => {
  it("muda as configurações sem tocar nas teclas, e o operador só lê", async () => {
    const menu = await newMenu("Configurações");
    const patched = await call(patchMenu, { method: "PATCH", cookie: owner, params: { id: menu }, body: { timeoutMs: 8000, maxAttempts: 2, onNoChoice: "hangup", language: "es" } });
    expect(patched.data).toMatchObject({ name: "Configurações", timeoutMs: 8000, maxAttempts: 2, onNoChoice: "hangup", language: "es", options: [expect.objectContaining({ digit: "9" })] });
    const outOfRange = await call(patchMenu, { method: "PATCH", cookie: owner, params: { id: menu }, body: { timeoutMs: 500 } });
    expect([outOfRange.status, outOfRange.code]).toEqual([400, "validation_error"]);
    const attempts = [
      call(createMenu, { method: "POST", cookie: operator, body: { name: "X", options: [PERSON] } }),
      call(patchMenu, { method: "PATCH", cookie: operator, params: { id: menu }, body: { name: "X" } }),
      call(putOptions, { method: "PUT", cookie: operator, params: { id: menu }, body: [PERSON] }),
      call(deleteMenu, { method: "DELETE", cookie: operator, params: { id: menu } }),
    ];
    for (const result of await Promise.all(attempts)) expect([result.status, result.code]).toEqual([403, "forbidden"]);
    expect((await call(getMenu, { cookie: operator, params: { id: menu } })).status).toBe(200);
  });
});

describe("T7 pela API: a organização B não alcança o menu da A", () => {
  it("recebe 404 em toda rota do menu, não o vê na lista e não aponta o próprio número para ele", async () => {
    const menu = await newMenu("Da organização A");
    await upload(menu, wav());
    const orgB = await createOrganization(panel.app, "ivr panel B");
    const intruder = (await createUser(panel.app, orgB, "owner")).cookie;
    const trunkB = await insert(panel.app, orgB, "insert into trunks (organization_id, name, host, auth_mode) values ($1, 'B', '203.0.113.71', 'ip') returning id", [orgB]);
    const numberB = await insert(panel.app, orgB, "insert into phone_numbers (organization_id, trunk_id, e164) values ($1, $2, '+5531977770000') returning id", [orgB, trunkB]);
    const before = await stored("select name, prompt_audio_ms, updated_at from ivr_menus where id = $1", [menu]);
    const as = { cookie: intruder, params: { id: menu } };
    const attempts = [
      call(getMenu, as),
      call(patchMenu, { ...as, method: "PATCH", body: { name: "Tomado" } }),
      call(putOptions, { ...as, method: "PUT", body: [PERSON] }),
      call(deleteMenu, { ...as, method: "DELETE" }),
      upload(menu, wav(), { cookie: intruder }),
      call(patchNumber, { cookie: intruder, method: "PATCH", params: { id: numberB }, body: { mode: "ivr", ivrMenuId: menu } }),
    ];
    for (const result of await Promise.all(attempts)) expect([result.status, result.code]).toEqual([404, "not_found"]);
    expect((await listen(menu, intruder)).status).toBe(404);
    expect((await call(listMenus, { cookie: intruder })).data).toEqual([]);
    expect(await stored("select name, prompt_audio_ms, updated_at from ivr_menus where id = $1", [menu])).toEqual(before);
    expect(await withOrg(panel.app, orgB, (q) => q.one("select mode, ivr_menu_id from phone_numbers where id = $1", [numberB]))).toEqual({ mode: "ai", ivr_menu_id: null });
  });
});
