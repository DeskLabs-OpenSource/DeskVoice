import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordingPath, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as open } from "../../s/[token]/route";
import { DELETE as revoke, POST as share } from "./calls/[id]/share/route";

const panel = startPanel();
afterAll(() => panel.close());

async function seed(org: string, options: { withAudio?: boolean } = {}): Promise<string> {
  const callId = await createCall(panel.app, org, NOW);
  const file = recordingPath(panel.deps.recordingsDir, org, callId);
  await mkdir(path.dirname(file), { recursive: true });
  if (options.withAudio !== false) await writeFile(file, Buffer.from("RIFF....WAVE"));
  return callId;
}

const create = (cookie: string, id: string, body?: unknown) => call(share, { method: "POST", cookie, params: { id }, body: body ?? {} });
const remove = (cookie: string, id: string) => call(revoke, { method: "DELETE", cookie, params: { id } });
/** Direto na rota: o helper `call` desembrulha JSON, e aqui há áudio binário. */
const openRaw = (token: string, query = ""): Promise<Response> =>
  open(new Request(`https://panel.test/s/${token}${query}`), { params: Promise.resolve({ token }) });
const read = async (token: string, query = ""): Promise<{ status: number; code?: string; body?: Record<string, unknown> }> => {
  const response = await openRaw(token, query);
  if (!(response.headers.get("content-type") ?? "").includes("json")) return { status: response.status };
  const json = (await response.json()) as { error?: { code?: string }; data?: Record<string, unknown> };
  return { status: response.status, code: json.error?.code, body: json.data };
};

describe("link para o titular", () => {
  it("cria, entrega o áudio sem sessão e registra a abertura", async () => {
    const org = await createOrganization(panel.app, "share happy");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org);

    const created = await create(owner.cookie, callId);
    expect(created.status).toBe(200);
    const data = created.data as { token: string; path: string; maxUses: number };
    expect(data.maxUses).toBe(10);
    expect(data.path).toBe(`/s/${data.token}`);

    // Sem cookie: é o titular, não o time.
    const first = await read(data.token);
    expect(first.status).toBe(200);
    expect(first.body?.audio).toBe(`/s/${data.token}?audio=1`);

    const audio = await openRaw(data.token, "?audio=1");
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(await audio.text()).toBe("RIFF....WAVE");

    const events = await withOrg(panel.app, org, (q) =>
      q.many<{ kind: string; payload: Record<string, unknown> }>("select kind, payload from organization_events where kind = 'share_opened' order by at"),
    );
    // Duas aberturas: primeiro o JSON, depois o áudio. A última é a do download.
    expect(events).toHaveLength(2);
    expect(events.at(-1)?.payload).toMatchObject({ callId, kind: "recording", audio: true });
  });

  it("token inventado, vencido e revogado respondem igual", async () => {
    const org = await createOrganization(panel.app, "share gone");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org);

    const invented = await read("a".repeat(43));
    expect([invented.status, invented.code]).toEqual([404, "not_found"]);

    const expired = await create(owner.cookie, callId);
    const expiredToken = (expired.data as { token: string }).token;
    // Vence no banco, não na borda: o caminho testado é o da rota pública lendo o prazo.
    await withOrg(panel.app, org, (q) => q.exec("update share_links set expires_at = $2 where call_id = $1", [callId, new Date(NOW.getTime() - 1000)]));
    const dead = await read(expiredToken);
    expect([dead.status, dead.code]).toEqual([404, "not_found"]);

    const live = await create(owner.cookie, callId);
    const liveToken = (live.data as { token: string }).token;
    expect((await read(liveToken)).status).toBe(200);
    await remove(owner.cookie, callId);
    const after = await read(liveToken);
    expect([after.status, after.code]).toEqual([404, "not_found"]);
  });

  it("chamada apagada a pedido do titular não gera link nem é servida por link antigo", async () => {
    const org = await createOrganization(panel.app, "share erased");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org);

    const created = await create(owner.cookie, callId);
    const token = (created.data as { token: string }).token;
    expect((await read(token)).status).toBe(200);

    await withOrg(panel.app, org, (q) => q.exec("update calls set erased_at = $2 where id = $1", [callId, NOW]));

    // O link que já existia para de servir, e não se cria outro.
    expect((await read(token)).status).toBe(404);
    const again = await create(owner.cookie, callId);
    expect([again.status, again.code]).toEqual([409, "call_erased"]);
  });

  it("sem gravação no disco, 409 em vez de link vazio", async () => {
    const org = await createOrganization(panel.app, "share no audio");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org, { withAudio: false });

    const result = await create(owner.cookie, callId);
    expect([result.status, result.code]).toEqual([409, "no_recording"]);
  });

  it("o operador não cria nem revoga", async () => {
    const org = await createOrganization(panel.app, "share operator");
    const operator = await createUser(panel.app, org, "operator");
    const callId = await seed(org);

    const created = await create(operator.cookie, callId);
    expect([created.status, created.code]).toEqual([403, "forbidden"]);
    const revoked = await remove(operator.cookie, callId);
    expect([revoked.status, revoked.code]).toEqual([403, "forbidden"]);
  });
});
