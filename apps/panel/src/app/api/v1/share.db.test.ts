import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordingPath, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as download, HEAD as probe } from "../../s/[token]/audio/route";
import SharePage from "../../s/[token]/page";
import type { PublicShare } from "../../s/[token]/share-view";
import { DELETE as revoke, GET as list, POST as share } from "./calls/[id]/share/route";

const panel = startPanel();
afterAll(() => panel.close());

// Um WAV de mentira, maior que um bloco de leitura do disco (64 KiB): o fluxo precisa juntar vários.
const AUDIO = Buffer.concat([Buffer.from("RIFF....WAVE"), Buffer.alloc(200_000, 7)]);

async function seed(org: string, options: { withAudio?: boolean } = {}): Promise<string> {
  const callId = await createCall(panel.app, org, NOW);
  const file = recordingPath(panel.deps.recordingsDir, org, callId);
  await mkdir(path.dirname(file), { recursive: true });
  if (options.withAudio !== false) await writeFile(file, AUDIO);
  return callId;
}

const create = (cookie: string, id: string, body: unknown = {}, origin?: string) => call(share, { method: "POST", cookie, params: { id }, body, origin });
const remove = (cookie: string, id: string) => call(revoke, { method: "DELETE", cookie, params: { id } });
const tokenOf = (url: string): string => url.split("/s/")[1] ?? "";
const fetchAudio = (token: string): Promise<Response> => download(new Request(`https://panel.test/s/${token}/audio`), { params: Promise.resolve({ token }) });
/** O que a página pública entrega à tela: `null` é a página de "não vale mais". */
const page = async (token: string): Promise<PublicShare | null> => {
  const element = await SharePage({ params: Promise.resolve({ token }) });
  return (element.props as { share: PublicShare | null }).share;
};
const usesOf = (org: string, callId: string) => withOrg(panel.app, org, (q) => q.many<{ uses: number }>("select uses from share_links where call_id = $1", [callId]));
const eventsOf = (org: string, kind: string) =>
  withOrg(panel.app, org, (q) => q.many<{ payload: Record<string, unknown> }>("select payload from organization_events where kind = $1 order by at, id", [kind]));

describe("link de quem ligou", () => {
  it("o endereço vem do endereço público da instalação, e não de por onde o pedido chegou", async () => {
    const org = await createOrganization(panel.app, "share address");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org);

    const created = await create(owner.cookie, callId, {}, "http://203.0.113.10:3080");
    expect(created.status).toBe(200);
    const data = created.data as { url: string; maxUses: number; expiresAt: string };
    expect(data.url).toMatch(/^https:\/\/panel\.test\/s\/[A-Za-z0-9_-]{43}$/);
    expect(data.maxUses).toBe(10);
    expect(data.expiresAt).toBe(new Date(NOW.getTime() + 72 * 3_600_000).toISOString());
    expect((await eventsOf(org, "share_created"))[0]?.payload).toMatchObject({ callId, maxUses: 10 });
  });

  it("abrir a página não gasta download; cada download gasta um, sai em fluxo e fica registrado", async () => {
    const org = await createOrganization(panel.app, "share happy");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org);
    const token = tokenOf((((await create(owner.cookie, callId)).data) as { url: string }).url);

    // Três aberturas (a prévia do aplicativo de mensagem, o titular, um recarregar): nada gasto.
    for (let i = 0; i < 3; i++) expect((await page(token))?.left).toBe(10);
    expect(await usesOf(org, callId)).toEqual([{ uses: 0 }]);

    const audio = await fetchAudio(token);
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(audio.headers.get("content-length")).toBe(String(AUDIO.length));
    expect(audio.headers.get("cache-control")).toContain("no-store");
    expect(audio.body).toBeInstanceOf(ReadableStream);
    expect(Buffer.from(await audio.arrayBuffer()).equals(AUDIO)).toBe(true);

    expect((await page(token))?.left).toBe(9);
    expect((await eventsOf(org, "share_downloaded")).map((event) => event.payload)).toEqual([{ callId, linkId: expect.any(String), use: 1, maxUses: 10 }]);

    // HEAD não é download: o Next o atenderia com o GET, e uma sondagem gastaria um uso.
    expect(probe().status).toBe(405);
    expect(await usesOf(org, callId)).toEqual([{ uses: 1 }]);
  });

  it("o limite de downloads vale com pedidos simultâneos", async () => {
    const org = await createOrganization(panel.app, "share race");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org);
    const token = tokenOf((((await create(owner.cookie, callId, { maxUses: 3 })).data) as { url: string }).url);

    const responses = await Promise.all(Array.from({ length: 8 }, () => fetchAudio(token)));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 200, 200, 303, 303, 303, 303, 303]);
    await Promise.all(responses.map((response) => response.body?.cancel()));
    expect(await usesOf(org, callId)).toEqual([{ uses: 3 }]);
    expect(await eventsOf(org, "share_downloaded")).toHaveLength(3);
    expect(await page(token)).toBeNull();
  });

  it("inventado, vencido, revogado, esgotado, de chamada apagada e sem áudio respondem igual", async () => {
    const org = await createOrganization(panel.app, "share gone");
    const owner = await createUser(panel.app, org, "owner");
    const linkFor = async (callId: string, body: unknown = {}): Promise<string> => tokenOf((((await create(owner.cookie, callId, body)).data) as { url: string }).url);
    const gone = async (token: string): Promise<void> => {
      expect(await page(token)).toBeNull();
      const response = await fetchAudio(token);
      // De volta para a página, que diz que o link não vale mais; nunca o motivo.
      expect([response.status, response.headers.get("location")]).toEqual([303, `/s/${token}`]);
    };

    await gone("a".repeat(43));

    const expiredCall = await seed(org);
    const expired = await linkFor(expiredCall);
    await withOrg(panel.app, org, (q) => q.exec("update share_links set expires_at = $2 where call_id = $1", [expiredCall, new Date(NOW.getTime() - 1000)]));
    await gone(expired);

    const revokedCall = await seed(org);
    const revoked = await linkFor(revokedCall);
    expect((await page(revoked))?.left).toBe(10);
    expect((await remove(owner.cookie, revokedCall)).data).toEqual({ revoked: 1 });
    await gone(revoked);

    const usedCall = await seed(org);
    const used = await linkFor(usedCall, { maxUses: 1 });
    expect((await fetchAudio(used)).status).toBe(200);
    await gone(used);

    const erasedCall = await seed(org);
    const erased = await linkFor(erasedCall);
    await withOrg(panel.app, org, (q) => q.exec("update calls set erased_at = $2 where id = $1", [erasedCall, NOW]));
    await gone(erased);
    expect([(await create(owner.cookie, erasedCall)).status, (await create(owner.cookie, erasedCall)).code]).toEqual([409, "call_erased"]);

    // A gravação saiu pelo prazo de guarda depois de o link ser criado.
    const purgedCall = await seed(org);
    const purged = await linkFor(purgedCall);
    await rm(recordingPath(panel.deps.recordingsDir, org, purgedCall));
    await gone(purged);
    expect(await usesOf(org, purgedCall)).toEqual([{ uses: 0 }]);
  });

  it("a tela vê os links vivos, sem o endereço, e sem gravação não há link", async () => {
    const org = await createOrganization(panel.app, "share list");
    const owner = await createUser(panel.app, org, "owner");
    const callId = await seed(org);
    await create(owner.cookie, callId);
    panel.clock.at = new Date(NOW.getTime() + 60_000);
    await create(owner.cookie, callId, { maxUses: 2 });
    panel.clock.at = NOW;

    const listed = await call(list, { cookie: owner.cookie, params: { id: callId } });
    const data = listed.data as { ttlHours: number; maxUses: number; links: Array<Record<string, unknown>> };
    expect([data.ttlHours, data.maxUses]).toEqual([72, 10]);
    expect(data.links.map((link) => [link.maxUses, link.uses, link.createdByName])).toEqual([
      [2, 0, "Test owner"],
      [10, 0, "Test owner"],
    ]);
    expect(JSON.stringify(data)).not.toContain("/s/");

    const silent = await seed(org, { withAudio: false });
    const result = await create(owner.cookie, silent);
    expect([result.status, result.code]).toEqual([409, "no_recording"]);
  });

  it("o operador não vê, não cria e não revoga", async () => {
    const org = await createOrganization(panel.app, "share operator");
    const operator = await createUser(panel.app, org, "operator");
    const callId = await seed(org);

    for (const result of [await call(list, { cookie: operator.cookie, params: { id: callId } }), await create(operator.cookie, callId), await remove(operator.cookie, callId)]) {
      expect([result.status, result.code]).toEqual([403, "forbidden"]);
    }
  });
});
