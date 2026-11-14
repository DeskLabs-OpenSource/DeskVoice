import { withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AGENT_TOKEN, NOW, PASSWORD, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { loginLimiter } from "../../../server/rate-limit";
import { clearReleaseCache } from "../../../server/releases";
import { PICKUP_MINUTES, RUN_MINUTES } from "../../../server/update";
import { POST as agent } from "./system/agent/route";
import { GET as readUpdate, POST as requestUpdate } from "./system/update/route";

const panel = startPanel();
const offline = (): Response => {
  throw new Error("getaddrinfo ENOTFOUND api.github.com");
};
const release = (version: string, body = "### Adicionado\n\n- **Novidade** Texto.") => ({ tag_name: `v${version}`, draft: false, prerelease: false, body, published_at: "2026-02-01T00:00:00Z", html_url: `https://example.test/${version}` });
const publish = (...list: unknown[]): void => {
  clearReleaseCache();
  panel.voice.respond = (url) => (url.startsWith("https://api.github.com/repos/DeskLabs-OpenSource/DeskVoice/releases") ? Response.json(list) : offline());
};
beforeEach(async () => {
  loginLimiter.clear();
  clearReleaseCache();
  panel.clock.at = NOW;
  panel.deps.appVersion = "0.1.0";
  panel.deps.agentToken = AGENT_TOKEN;
  // Por padrão a 0.2.0 está publicada, com notas, e é para ela que o servidor iria.
  publish(release("0.2.0"), release("0.1.0"));
  panel.voice.requests.length = 0;
  // O índice de "um pedido aberto" vale para a instalação inteira: cada teste começa sem nenhum.
  await withSystem(panel.app, (q) => q.exec("delete from update_requests"));
  // Os booleanos de serviço são da instalação inteira, e moram em duas tabelas: `whatsapp_sessions`
  // responde por `whatsapp` e `whatsapp_call_sessions` por `whatsappCalls`. Zerar só a primeira
  // deixava o teste dependente da ordem dos arquivos (issue #177).
  await withSystem(panel.app, async (q) => {
    await q.exec("update whatsapp_sessions set service_wanted = false");
    await q.exec("update whatsapp_call_sessions set service_wanted = false");
  });
});
afterAll(() => panel.close());

type Person = Awaited<ReturnType<typeof createUser>>;
/** Uma organização com dono. Por padrão o agente já falou: anunciou a 0.1.0 instalada e a 0.2.0 como alvo. */
const newOrg = async (label: string, agentSpoke = true): Promise<{ org: string; owner: Person }> => {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  if (agentSpoke) await speak();
  return { org, owner };
};
const later = (minutes: number): void => {
  panel.clock.at = new Date(panel.clock.at.getTime() + minutes * 60_000);
};
const speak = (report: unknown = { version: "0.1.0", target: "0.2.0" }, headers: Record<string, string> = { authorization: `Bearer ${AGENT_TOKEN}` }) => call(agent, { method: "POST", body: report, headers });
const ask = (cookie: string, body: unknown = { password: PASSWORD, target: "0.2.0" }) => call(requestUpdate, { method: "POST", cookie, body });
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];
interface State {
  running: { version: string; updatable: boolean };
  agent: { lastSeenAt: string; version: string; targetVersion: string | null; responding: boolean; lastFailureAt: string | null; lastFailureDetail: string | null } | null;
  request: { status: string; fromVersion: string; targetVersion: string; toVersion: string | null; detail: string | null; outputKept: boolean; acceptedAt: string | null; finishedAt: string | null } | null;
  published: { ok: true; latest: string | null; newer: Array<{ version: string; attention: Array<{ title: string; text: string }>; sections: unknown[] }> } | { ok: false };
  offer: { target: string | null; notesReady: boolean; releases: Array<{ version: string }>; unseen: boolean };
}
const state = async (cookie: string): Promise<State> => (await call(readUpdate, { cookie })).data as State;
const notices = (org: string) => withOrg(panel.app, org, (q) => q.many<{ body: string }>("select body from notifications where channel = 'panel' order by created_at, id"));

describe("the agent route", () => {
  it("answers nobody without the installer secret, and nobody at all when no secret is configured", async () => {
    expect(refusal(await speak({ version: "0.1.0" }, {}))).toEqual([401, "unauthenticated"]);
    expect(refusal(await speak({ version: "0.1.0" }, { authorization: "Bearer wrong" }))).toEqual([401, "unauthenticated"]);
    expect(refusal(await speak({ version: "0.1.0" }, { authorization: `Bearer ${AGENT_TOKEN}x` }))).toEqual([401, "unauthenticated"]);
    panel.deps.agentToken = "";
    expect(refusal(await speak({ version: "0.1.0" }, { authorization: "Bearer " }))).toEqual([401, "unauthenticated"]);
    expect(refusal(await speak({ version: "0.1.0" }, {}))).toEqual([401, "unauthenticated"]);
  });

  it("does not exist for a request that came through a proxy, even with the right secret", async () => {
    const result = await speak({ version: "0.1.0" }, { authorization: `Bearer ${AGENT_TOKEN}`, "x-forwarded-for": "203.0.113.9" });
    expect(refusal(result)).toEqual([404, "not_found"]);
    // Um proxy de confiança repassa a lista inteira: loopback forjado no começo não vale.
    for (const forged of ["127.0.0.1, 203.0.113.9", "203.0.113.9, 127.0.0.1", "10.0.0.5", ""]) {
      expect(refusal(await speak({ version: "0.1.0" }, { authorization: `Bearer ${AGENT_TOKEN}`, "x-forwarded-for": forged }))).toEqual([404, "not_found"]);
    }
  });

  it("hears the agent as the real server delivers it: the header filled with this machine's own address", async () => {
    // O servidor do Next preenche X-Forwarded-For com o endereço da conexão quando ele não vem.
    for (const loopback of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect((await speak({ version: "0.1.0" }, { authorization: `Bearer ${AGENT_TOKEN}`, "x-forwarded-for": loopback })).data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
    }
  });

  it("answers the two booleans and nothing else, with or without a request waiting", async () => {
    const { owner } = await newOrg("update boolean");
    expect((await speak()).data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
    await ask(owner.cookie);
    const accepted = await speak();
    expect(accepted.data).toEqual({ update: true, whatsapp: false, whatsappCalls: false });
    expect(JSON.parse(accepted.text)).toEqual({ ok: true, data: { update: true, whatsapp: false, whatsappCalls: false } });
    expect((await speak()).data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
  });

  it("records when the agent last spoke, the version it announced and its last communication failure", async () => {
    const { owner } = await newOrg("update heartbeat", false);
    expect((await state(owner.cookie)).agent).toBeNull();
    await speak({ version: "0.1.0", lastFailure: { at: "2026-03-01T14:58:00Z", detail: "o painel não respondeu" } });
    later(2);
    await speak({ version: "0.1.0" });
    expect((await state(owner.cookie)).agent).toEqual({
      lastSeenAt: panel.clock.at.toISOString(),
      version: "0.1.0",
      targetVersion: null,
      responding: true,
      lastFailureAt: "2026-03-01T14:58:00.000Z",
      lastFailureDetail: "o painel não respondeu",
    });
    later(6);
    const silent = (await state(owner.cookie)).agent;
    expect(silent?.responding).toBe(false);
    expect(silent?.lastSeenAt).toBe(new Date(panel.clock.at.getTime() - 6 * 60_000).toISOString());
  });

  it("refuses a malformed report and keeps an oversized one instead of bouncing it forever", async () => {
    expect(refusal(await speak({ nothing: true }))).toEqual([400, "validation_error"]);
    const { owner } = await newOrg("update oversized");
    await ask(owner.cookie);
    await speak();
    expect((await speak({ version: "0.1.0", result: { outcome: "failed", detail: "x".repeat(20_000) } })).status).toBe(200);
    expect((await state(owner.cookie)).request?.detail).toHaveLength(8000);
  });
});

describe("who can ask for an update", () => {
  it("lets an owner or an admin ask, and never an operator", async () => {
    const { org, owner } = await newOrg("update roles");
    const admin = await createUser(panel.app, org, "admin");
    const operator = await createUser(panel.app, org, "operator");
    expect(refusal(await ask(operator.cookie))).toEqual([403, "forbidden"]);
    expect((await state(owner.cookie)).request).toBeNull();
    expect((await ask(admin.cookie)).status).toBe(200);
    expect((await state(operator.cookie)).request?.status).toBe("requested");
  });

  it("asks for the password again, and counts wrong attempts like the login does", async () => {
    const { owner } = await newOrg("update password");
    expect(refusal(await ask(owner.cookie, {}))).toEqual([400, "validation_error"]);
    expect(refusal(await ask(owner.cookie, { password: "", target: "0.2.0" }))).toEqual([400, "validation_error"]);
    for (let attempt = 0; attempt < 5; attempt++) expect(refusal(await ask(owner.cookie, { password: "not the password", target: "0.2.0" }))).toEqual([400, "wrong_password"]);
    expect(refusal(await ask(owner.cookie))).toEqual([429, "too_many_attempts"]);
    expect((await state(owner.cookie)).request).toBeNull();
    expect((await speak()).data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
  });

  it("refuses when the running version is not a published one, and says so on the screen", async () => {
    const { owner } = await newOrg("update local");
    panel.deps.appVersion = "local";
    expect(refusal(await ask(owner.cookie))).toEqual([409, "update_unavailable"]);
    expect((await state(owner.cookie)).running).toEqual({ version: "local", updatable: false });
  });
});

describe("one request at a time, and every request ends", () => {
  it("keeps a single open request in the whole installation", async () => {
    const first = await newOrg("update single A");
    const second = await newOrg("update single B");
    expect((await ask(first.owner.cookie)).status).toBe(200);
    expect(refusal(await ask(first.owner.cookie))).toEqual([409, "update_in_progress"]);
    expect(refusal(await ask(second.owner.cookie))).toEqual([409, "update_in_progress"]);
    await speak();
    expect(refusal(await ask(second.owner.cookie))).toEqual([409, "update_in_progress"]);
    // O banco recusa por conta própria, sem depender da rota.
    await expect(
      withOrg(panel.app, second.org, (q) => q.exec("insert into update_requests (organization_id, from_version, target_version) values ($1, '0.1.0', '0.2.0')", [second.org])),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("shows the result the agent brought, and lets another request be made", async () => {
    const { org, owner } = await newOrg("update result");
    await ask(owner.cookie);
    await speak();
    expect((await state(owner.cookie)).request).toMatchObject({ status: "running", fromVersion: "0.1.0", toVersion: null });
    later(4);
    expect((await speak({ version: "0.2.0", result: { outcome: "succeeded", toVersion: "0.2.0", outputKept: true, detail: "Atualizado para 0.2.0" } })).data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
    expect((await state(owner.cookie)).request).toMatchObject({ status: "succeeded", toVersion: "0.2.0", detail: "Atualizado para 0.2.0", outputKept: true, finishedAt: panel.clock.at.toISOString() });
    const bodies = (await notices(org)).map((notice) => notice.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("começou");
    expect(bodies[1]).toContain("versão 0.2.0");

    await speak({ version: "0.2.0", target: "0.3.0" });
    publish(release("0.3.0"), release("0.2.0"));
    expect((await ask(owner.cookie, { password: PASSWORD, target: "0.3.0" })).status).toBe(200);
    await speak({ version: "0.2.0", target: "0.3.0" });
    await speak({ version: "0.2.0", target: "0.3.0", result: { outcome: "rolled_back", detail: "As migrations da versão 0.3.0 falharam." } });
    // O agente de uma versão anterior não manda o campo: a tela não aponta um arquivo que ele não guardou.
    expect((await state(owner.cookie)).request).toMatchObject({ status: "rolled_back", detail: "As migrations da versão 0.3.0 falharam.", outputKept: false });
  });

  it("expires a request the agent never picked up, visibly, and frees the next one", async () => {
    const { org, owner } = await newOrg("update never picked");
    await ask(owner.cookie);
    later(PICKUP_MINUTES - 1);
    expect((await state(owner.cookie)).request?.status).toBe("requested");
    later(2);
    expect((await state(owner.cookie)).request).toMatchObject({ status: "expired", acceptedAt: null, finishedAt: panel.clock.at.toISOString() });
    expect((await notices(org)).map((notice) => notice.body)).toEqual([expect.stringContaining("venceu")]);
    // O agente que voltar depois não executa um pedido vencido.
    expect((await speak()).data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
    expect((await ask(owner.cookie)).status).toBe(200);
  });

  it("expires a request the agent accepted and never concluded, without waiting for anyone to look at the screen", async () => {
    const { owner } = await newOrg("update never concluded");
    await ask(owner.cookie);
    await speak();
    later(RUN_MINUTES + 1);
    // Ninguém abriu a tela: o próprio pedido seguinte vence o que ficou parado.
    expect((await ask(owner.cookie)).status).toBe(200);
    const rows = await withSystem(panel.app, (q) => q.many<{ status: string; accepted: boolean }>("select status, accepted_at is not null as accepted from update_requests order by requested_at"));
    expect(rows).toEqual([
      { status: "expired", accepted: true },
      { status: "requested", accepted: false },
    ]);
  });

  it("lets a result that arrives after the deadline replace the expiry with what really happened", async () => {
    const { owner } = await newOrg("update late result");
    await ask(owner.cookie);
    await speak();
    later(RUN_MINUTES + 5);
    expect((await state(owner.cookie)).request?.status).toBe("expired");
    await speak({ version: "0.2.0", result: { outcome: "succeeded", toVersion: "0.2.0", detail: "" } });
    expect((await state(owner.cookie)).request).toMatchObject({ status: "succeeded", toVersion: "0.2.0" });
  });
});

describe("nobody is updated to a version they did not confirm", () => {
  it("names the version the server would go to, with the notes up to it, and keeps the version the person saw in the request", async () => {
    const { owner } = await newOrg("update target");
    // A lista pública já tem a 0.3.0, mas o servidor ainda iria para a 0.2.0: é a 0.2.0 que a tela oferece.
    publish(release("0.3.0"), release("0.2.0"), release("0.1.0"));
    const seen = await state(owner.cookie);
    expect(seen.published).toMatchObject({ ok: true, latest: "0.3.0" });
    expect(seen.offer.target).toBe("0.2.0");
    expect(seen.offer.notesReady).toBe(true);
    expect(seen.offer.releases.map((item) => item.version)).toEqual(["0.2.0"]);
    // E a tela diz que a 0.3.0 existe e o servidor ainda não a viu, em vez de calar sobre ela.
    expect(seen.offer.unseen).toBe(true);
    await ask(owner.cookie);
    expect((await state(owner.cookie)).request).toMatchObject({ status: "requested", targetVersion: "0.2.0" });
  });

  it("does not offer the update while the notes of the target version are not published", async () => {
    const { owner } = await newOrg("update no notes");
    await speak({ version: "0.1.0", target: "0.3.0" });
    const seen = await state(owner.cookie);
    expect(seen.offer).toEqual({ target: "0.3.0", notesReady: false, releases: [expect.objectContaining({ version: "0.2.0" })], unseen: false });
    expect(refusal(await ask(owner.cookie, { password: PASSWORD, target: "0.3.0" }))).toEqual([409, "update_notes_missing"]);
    publish();
    panel.voice.respond = offline;
    expect(refusal(await ask(owner.cookie, { password: PASSWORD, target: "0.3.0" }))).toEqual([409, "update_notes_missing"]);
    expect((await state(owner.cookie)).request).toBeNull();
  });

  it("refuses a confirmation for a version other than the one the agent announced last", async () => {
    const silent = await newOrg("update no agent", false);
    expect(refusal(await ask(silent.owner.cookie))).toEqual([409, "update_target_changed"]);
    const { owner } = await newOrg("update stale screen");
    await speak({ version: "0.1.0", target: "0.3.0" });
    expect(refusal(await ask(owner.cookie))).toEqual([409, "update_target_changed"]);
    await speak({ version: "0.2.0" });
    expect(refusal(await ask(owner.cookie))).toEqual([409, "update_target_changed"]);
  });

  it("ends the request, answering no, when a newer version came out between the confirmation and the execution", async () => {
    const { org, owner } = await newOrg("update superseded");
    await ask(owner.cookie);
    const answer = await speak({ version: "0.1.0", target: "0.3.0" });
    expect(answer.data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
    expect((await state(owner.cookie)).request).toMatchObject({ status: "superseded", targetVersion: "0.2.0", acceptedAt: null, finishedAt: panel.clock.at.toISOString() });
    expect((await notices(org)).map((notice) => notice.body)).toEqual([expect.stringContaining("versão mais nova")]);
    // Nada ficou aberto: o agente segue ouvindo "não", e outro pedido pode ser feito para a versão nova.
    expect((await speak({ version: "0.1.0", target: "0.3.0" })).data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
    publish(release("0.3.0"), release("0.2.0"));
    expect((await ask(owner.cookie, { password: PASSWORD, target: "0.3.0" })).status).toBe(200);
    expect((await speak({ version: "0.1.0", target: "0.3.0" })).data).toEqual({ update: true, whatsapp: false, whatsappCalls: false });
  });

  it("ends the request with nothing to do when the server got there by another path", async () => {
    const { owner } = await newOrg("update already there");
    await ask(owner.cookie);
    expect((await speak({ version: "0.2.0" })).data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
    expect((await state(owner.cookie)).request).toMatchObject({ status: "nothing_to_do", acceptedAt: null });
  });
});

describe("what an operator sees", () => {
  it("shows the state to an operator without the updater output or the agent failure text, which name paths of the server", async () => {
    const { org, owner } = await newOrg("update operator view");
    const operator = await createUser(panel.app, org, "operator");
    const admin = await createUser(panel.app, org, "admin");
    await speak({ version: "0.1.0", target: "0.2.0", lastFailure: { at: "2026-03-01T14:58:00Z", detail: "não achei /home/ana/DeskVoice/deploy/.env" } });
    await ask(owner.cookie);
    await speak();
    await speak({ version: "0.1.0", target: "0.2.0", result: { outcome: "rolled_back", detail: "Backup em /home/ana/DeskVoice/backups/x" } });
    for (const cookie of [owner.cookie, admin.cookie]) {
      const full = await state(cookie);
      expect(full.request).toMatchObject({ status: "rolled_back", detail: "Backup em /home/ana/DeskVoice/backups/x" });
      expect(full.agent?.lastFailureDetail).toBe("não achei /home/ana/DeskVoice/deploy/.env");
    }
    const limited = await call(readUpdate, { cookie: operator.cookie });
    const seen = limited.data as State;
    expect(seen.request).toMatchObject({ status: "rolled_back", detail: null });
    expect(seen.agent).toMatchObject({ responding: true, lastFailureAt: "2026-03-01T14:58:00.000Z", lastFailureDetail: null });
    expect(limited.text).not.toContain("/home/ana");
  });
});

describe("the version screen", () => {
  const releases = [
    { tag_name: "v0.3.0-rc.1", draft: false, prerelease: true, body: "", published_at: "2026-03-01T00:00:00Z", html_url: "https://example.test/rc" },
    { tag_name: "v0.1.0", draft: false, prerelease: false, body: "### Adicionado\n\n- **Primeira versão** Texto.", published_at: "2026-01-01T00:00:00Z", html_url: "https://example.test/010" },
    {
      tag_name: "v0.2.0",
      draft: false,
      prerelease: false,
      body: "### Requer atenção\n\n- **Portas de áudio** Libere as portas antes de atualizar.\n\n### Adicionado\n\n- **Transferência** O agente transfere a ligação.\n  Segunda linha do item.",
      published_at: "2026-02-01T00:00:00Z",
      html_url: "https://example.test/020",
    },
    { tag_name: "v0.10.0", draft: true, prerelease: false, body: "", published_at: null, html_url: "https://example.test/draft" },
  ];

  it("shows the running version from the process, the latest published one and the notes in between, with the attention block apart", async () => {
    const { owner } = await newOrg("update screen");
    publish(...releases);
    panel.voice.requests.length = 0;
    const seen = await state(owner.cookie);
    expect(seen.running).toEqual({ version: "0.1.0", updatable: true });
    expect(seen.published).toEqual({
      ok: true,
      latest: "0.2.0",
      newer: [
        {
          version: "0.2.0",
          publishedAt: "2026-02-01T00:00:00Z",
          url: "https://example.test/020",
          attention: [{ title: "Portas de áudio", text: "Libere as portas antes de atualizar." }],
          sections: [{ heading: "Adicionado", items: [{ title: "Transferência", text: "O agente transfere a ligação. Segunda linha do item." }] }],
        },
      ],
    });
    // A consulta não leva nada desta instalação: nem versão, nem endereço, nem credencial.
    const sent = panel.voice.requests.filter((request) => request.url.includes("api.github.com"));
    expect(sent.map((request) => request.url)).toEqual(["https://api.github.com/repos/DeskLabs-OpenSource/DeskVoice/releases?per_page=30"]);

    // A versão em execução é a do processo: trocou o processo, trocou a resposta, sem nada gravado.
    panel.deps.appVersion = "0.2.0";
    const after = await state(owner.cookie);
    expect(after.running.version).toBe("0.2.0");
    expect(after.published).toMatchObject({ ok: true, latest: "0.2.0", newer: [] });
  });

  it("tells a version the server has not seen yet apart from being on the latest one", async () => {
    // A 0.2.0 saiu na lista pública, e o agente ainda não consultou as tags: não anunciou alvo.
    const { owner } = await newOrg("update not seen yet");
    await speak({ version: "0.1.0" });
    const before = await state(owner.cookie);
    expect(before.published).toMatchObject({ ok: true, latest: "0.2.0" });
    expect(before.offer).toMatchObject({ target: null, unseen: true });
    // O agente viu: o alvo é a mais recente, e não há mais o que ele não tenha visto.
    await speak({ version: "0.1.0", target: "0.2.0" });
    expect((await state(owner.cookie)).offer).toMatchObject({ target: "0.2.0", unseen: false });
    // O agente já atualizou e anuncia a 0.2.0, e o painel antigo ainda responde: ele não "deixou de ver".
    await speak({ version: "0.2.0" });
    expect((await state(owner.cookie)).offer).toMatchObject({ target: null, unseen: false });
    // Depois da atualização: instalada igual à mais recente, sem alvo. É "está na mais recente".
    panel.deps.appVersion = "0.2.0";
    await speak({ version: "0.2.0" });
    const after = await state(owner.cookie);
    expect(after.published).toMatchObject({ ok: true, latest: "0.2.0" });
    expect(after.offer).toMatchObject({ target: null, unseen: false });
  });

  it("says it could not check when the public source does not answer, and still shows the running version", async () => {
    const { owner } = await newOrg("update offline");
    panel.voice.respond = offline;
    clearReleaseCache();
    const seen = await state(owner.cookie);
    expect(seen.published).toEqual({ ok: false });
    expect(seen.running.version).toBe("0.1.0");
    expect(seen.offer).toEqual({ target: "0.2.0", notesReady: false, releases: [], unseen: false });
    panel.voice.respond = () => Response.json({ message: "not the expected shape" });
    clearReleaseCache();
    expect((await state(owner.cookie)).published).toEqual({ ok: false });
  });
});
