import { withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { startInternalApi } from "../../../../../voice/src/internal-api";
import { silentLogger } from "../../../../../voice/src/log";
import { WACALLS_TOKEN, startFakeWacalls } from "../../../../../voice/src/testing/fake-wacalls";
import { manualTime } from "../../../../../voice/src/testing/helpers";
import { createWhatsAppCalls } from "../../../../../voice/src/whatsapp-calls";
import { AGENT_TOKEN, NOW, call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import type { WhatsAppCallsView } from "../../../server/whatsapp-calls";
import { POST as agent } from "./system/agent/route";
import { GET as health } from "./system/health/route";
import { POST as connect } from "./whatsapp-calls/connect/route";
import { POST as disconnect } from "./whatsapp-calls/disconnect/route";
import { PATCH as choose, GET as read } from "./whatsapp-calls/route";
import { POST as service } from "./whatsapp-calls/service/route";

/**
 * As rotas do painel contra o processo de voz de verdade (a API interna e o canal do WaCalls), com
 * um WaCalls falso no lugar do serviço. O painel nunca fala com o WaCalls: é o processo de voz que fala.
 */
const panel = startPanel();
const wacalls = await startFakeWacalls();
const INTERNAL_TOKEN = "internal-test-token";
const unused = async (): Promise<never> => {
  throw new Error("not part of this test");
};
let channel = createWhatsAppCalls(wacalls.options, { schedule: manualTime().schedule, log: silentLogger });
const voice = await startInternalApi({
  port: 0,
  host: "127.0.0.1",
  token: INTERNAL_TOKEN,
  handlers: {
    health: async () => ({ asterisk: { status: "ok", detail: "" }, web: { status: "ok", detail: "" }, trunks: [] }),
    applyTrunks: unused,
    outbound: unused,
    simulate: unused,
    web: unused,
    // Indireto: um teste troca o canal por um sem token.
    whatsappCalls: { state: (input) => channel.state(input), connect: (input) => channel.connect(input), disconnect: (input) => channel.disconnect(input) },
  },
});

beforeEach(() => {
  panel.clock.at = NOW;
  panel.deps.fetch = (input, init) => fetch(input, init);
  panel.deps.voiceUrl = `http://127.0.0.1:${voice.port}`;
  panel.deps.internalToken = INTERNAL_TOKEN;
  wacalls.requests.length = 0;
  wacalls.state.down = false;
});
afterAll(async () => {
  // O banco é um só para os testes de banco: o pedido do serviço não pode vazar para os outros arquivos.
  await withSystem(panel.app, (q) => q.exec("update whatsapp_call_sessions set service_wanted = false"));
  channel.close();
  await voice.close();
  await wacalls.stop();
  await panel.close();
});

type Person = Awaited<ReturnType<typeof createUser>>;
const agentSays = (whatsappCalls?: unknown) =>
  call(agent, { method: "POST", body: { version: "0.5.0", ...(whatsappCalls !== undefined && { whatsappCalls }) }, headers: { authorization: `Bearer ${AGENT_TOKEN}` } });
const wantService = (cookie: string, wanted: boolean) => call(service, { method: "POST", cookie, body: { wanted } });
const state = async (cookie: string): Promise<WhatsAppCallsView> => (await call(read, { cookie })).data as WhatsAppCallsView;
const start = (cookie: string) => call(connect, { method: "POST", cookie, body: {} });
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];
const notices = async (org: string): Promise<string[]> =>
  (await withOrg(panel.app, org, (q) => q.many<{ body: string }>("select body from notifications where channel = 'panel' order by created_at, id"))).map((row) => row.body);
// O banco é um só entre os arquivos de teste: o pedido do WAHA que outro arquivo deixou também sai,
// para a resposta do agente ser conferida inteira.
const nobodyWants = () =>
  withSystem(panel.app, async (q) => {
    await q.exec("update whatsapp_call_sessions set service_wanted = false");
    await q.exec("update whatsapp_sessions set service_wanted = false");
  });
const sessionOf = (org: string) => {
  const found = wacalls.byName(`deskvoice_${org}`);
  if (!found) throw new Error("no WaCalls session for the organization");
  return found;
};
const bareOrg = async (label: string): Promise<{ org: string; owner: Person }> => {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  await agentSays({ state: "absent" });
  return { org, owner };
};
/** Organização que pediu o serviço, com o agente já tendo subido o WaCalls. */
const upOrg = async (label: string) => {
  const created = await bareOrg(label);
  await wantService(created.owner.cookie, true);
  await agentSays({ state: "running" });
  return created;
};
const healthLine = async (cookie: string) => ((await call(health, { cookie })).data as { whatsapp_calls: { status: string; reason: string } }).whatsapp_calls;

describe("who can use the WhatsApp calls block", () => {
  it("refuses a stranger and an operator on every route, before anything reaches WaCalls", async () => {
    const { org, owner } = await upOrg("calls roles");
    await start(owner.cookie);
    const operator = await createUser(panel.app, org, "operator");
    wacalls.requests.length = 0;
    for (const [handler, method] of [[read, "GET"], [connect, "POST"], [disconnect, "POST"], [service, "POST"]] as const) {
      const body = method === "POST" ? { body: { wanted: false } } : {};
      const anonymous = await call(handler, { method, ...body });
      expect(refusal(anonymous), method).toEqual([401, "unauthenticated"]);
      expect(anonymous.text).not.toContain("QR-");
      expect(refusal(await call(handler, { method, cookie: operator.cookie, ...body })), method).toEqual([403, "forbidden"]);
    }
    expect(wacalls.requests).toEqual([]);
  });
});

describe("the service exists only on the server of whoever asked for it", () => {
  it("by default it is not installed: nothing is asked of WaCalls and the agent hears no", async () => {
    await nobodyWants();
    const { owner } = await bareOrg("calls default");
    expect(await state(owner.cookie)).toMatchObject({ available: true, service: "absent", status: "disconnected", qr: null, agent: "responding" });
    expect((await agentSays({ state: "absent" })).data).toEqual({ update: false, whatsapp: false, whatsappCalls: false });
    expect(await healthLine(owner.cookie)).toMatchObject({ status: "ok", reason: "whatsapp_calls_absent" });
    expect(wacalls.requests).toEqual([]);
  });

  it("installing only records the wish: the agent hears yes in its own field, and the screen follows what it tells", async () => {
    await nobodyWants();
    const { org, owner } = await bareOrg("calls install");
    expect(refusal(await start(owner.cookie))).toEqual([409, "whatsapp_calls_service_absent"]);
    expect((await wantService(owner.cookie, true)).data).toMatchObject({ service: "preparing" });
    expect((await agentSays({ state: "absent" })).data).toEqual({ update: false, whatsapp: false, whatsappCalls: true });
    expect(await healthLine(owner.cookie)).toMatchObject({ status: "ok", reason: "whatsapp_calls_preparing" });
    panel.clock.at = new Date(NOW.getTime() + 30_000);
    await agentSays({ state: "failed", reason: "no_disk", freeDiskMb: 900, neededDiskMb: 1200 });
    expect(await state(owner.cookie)).toMatchObject({ service: "failed", serviceReason: "no_disk", disk: { freeMb: 900, neededMb: 1200 } });
    expect(await healthLine(owner.cookie)).toMatchObject({ status: "warn", reason: "whatsapp_calls_service_failed" });
    panel.clock.at = new Date(NOW.getTime() + 60_000);
    await agentSays({ state: "running" });
    expect(await state(owner.cookie)).toMatchObject({ service: "running", status: "disconnected" });
    expect(await healthLine(owner.cookie)).toMatchObject({ status: "warn", reason: "whatsapp_calls_no_number" });
    expect(await notices(org)).toEqual([
      "Test owner pediu a instalação do serviço de ligação pelo WhatsApp neste servidor. O servidor baixa e sobe o serviço em alguns minutos.",
      "O servidor não conseguiu instalar ou remover o serviço de ligação pelo WhatsApp. Ele tenta de novo em alguns minutos; o motivo está em Configurações.",
      "O serviço de ligação pelo WhatsApp está instalado neste servidor. Conecte um número em Configurações.",
    ]);
  });

  it("the WhatsApp by QR code and the WhatsApp calls are two separate wishes", async () => {
    await nobodyWants();
    const { owner } = await bareOrg("calls separate");
    await wantService(owner.cookie, true);
    const answer = (await agentSays()).data as { whatsapp: boolean; whatsappCalls: boolean };
    expect(answer.whatsappCalls).toBe(true);
    // O pedido de ligação não liga o WAHA: cada serviço tem o seu campo.
    expect(await withSystem(panel.app, (q) => q.one<{ wanted: boolean }>("select exists (select 1 from whatsapp_sessions where service_wanted) as wanted"))).toEqual({ wanted: answer.whatsapp });
  });
});

describe("pairing the number by QR code", () => {
  it("connect asks the voice process, which creates the session; the QR code that came before the id is on the screen", async () => {
    const { org, owner } = await upOrg("calls pair");
    const connected = (await start(owner.cookie)).data as WhatsAppCallsView;
    expect(connected).toMatchObject({ status: "qr", failure: null, phone: null });
    expect(connected.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from((connected.qr ?? "").split(",")[1] ?? "", "base64").toString()).toContain("<path d=\"M");
    expect(sessionOf(org).name).toBe(`deskvoice_${org}`);
    // Token só no cabeçalho, nunca no endereço; e nunca a rota de re-parear.
    for (const request of wacalls.requests) {
      expect(request.authorization).toBe(`Bearer ${WACALLS_TOKEN}`);
      expect(request.query).toBe("");
    }
    expect(wacalls.requests.some((request) => request.path.endsWith("/pair"))).toBe(false);
  });

  it("once read: the number shows, one notice however many times the screen asks, and the health line is ok", async () => {
    const { org, owner } = await upOrg("calls read");
    await start(owner.cookie);
    wacalls.scan(sessionOf(org), "5531988887777");
    for (let i = 0; i < 3; i += 1) expect(await state(owner.cookie)).toMatchObject({ status: "connected", phone: "+5531988887777", connectedAt: NOW.toISOString(), qr: null });
    const connectedNotices = (await notices(org)).filter((body) => body.includes("conectado."));
    expect(connectedNotices).toEqual(["Ligação pelo WhatsApp: número +5531988887777 conectado. Escolha em Configurações o agente que atende; até lá, as ligações continuam tocando no celular."]);
    // Conectado sem agente: ninguém atende, e a saúde diz isso.
    expect(await healthLine(owner.cookie)).toMatchObject({ status: "warn", reason: "whatsapp_calls_no_agent" });
    expect(await withOrg(panel.app, org, (q) => q.one("select wacalls_session_id as id from whatsapp_call_sessions"))).toEqual({ id: sessionOf(org).id });
  });

  it("the owner chooses the agent that answers: the health line turns ok, and nobody again turns it back to a warning", async () => {
    const { org, owner } = await upOrg("calls agent");
    await start(owner.cookie);
    wacalls.scan(sessionOf(org), "5531988887777");
    expect(await state(owner.cookie)).toMatchObject({ status: "connected", agentId: null });
    const agentId = await insert(panel.app, org, "insert into agents (organization_id, name, engine) values ($1, 'Recepção', 'simulated') returning id", [org]);
    const chosen = await call(choose, { method: "PATCH", cookie: owner.cookie, body: { agentId } });
    expect(chosen.data).toMatchObject({ status: "connected", agentId });
    expect(await healthLine(owner.cookie)).toMatchObject({ status: "ok", reason: "whatsapp_calls_connected" });
    expect((await call(choose, { method: "PATCH", cookie: owner.cookie, body: { agentId: null } })).data).toMatchObject({ agentId: null });
    expect(await healthLine(owner.cookie)).toMatchObject({ status: "warn", reason: "whatsapp_calls_no_agent" });
  });

  it("an agent from another organization cannot be chosen, and an operator cannot choose at all", async () => {
    const { org, owner } = await upOrg("calls agent guard");
    const other = await createOrganization(panel.app, "calls agent guard other");
    const foreign = await insert(panel.app, other, "insert into agents (organization_id, name, engine) values ($1, 'Outra', 'simulated') returning id", [other]);
    expect(refusal(await call(choose, { method: "PATCH", cookie: owner.cookie, body: { agentId: foreign } }))).toEqual([404, "not_found"]);
    const operator = await createUser(panel.app, org, "operator");
    const own = await insert(panel.app, org, "insert into agents (organization_id, name, engine) values ($1, 'Recepção', 'simulated') returning id", [org]);
    expect(refusal(await call(choose, { method: "PATCH", cookie: operator.cookie, body: { agentId: own } }))).toEqual([403, "forbidden"]);
    expect(await withOrg(panel.app, org, (q) => q.one("select agent_id from whatsapp_call_sessions"))).toEqual({ agent_id: null });
  });

  it("the same number connected for messages is named on the screen, so the person knows the risk is shared", async () => {
    const { org, owner } = await upOrg("calls same number");
    await withOrg(panel.app, org, (q) =>
      q.exec("insert into whatsapp_sessions (organization_id, session_name, status, phone_e164) values ($1, $2, 'connected', '+5531977776666')", [org, `messages-${org}`]),
    );
    expect((await state(owner.cookie)).messagesPhone).toBe("+5531977776666");
    await start(owner.cookie);
    wacalls.scan(sessionOf(org), "5531977776666");
    expect(await state(owner.cookie)).toMatchObject({ phone: "+5531977776666", messagesPhone: "+5531977776666" });
  });

  it("a code nobody read expires; connecting again deletes and creates, never re-pairs", async () => {
    const { org, owner } = await upOrg("calls expired");
    await start(owner.cookie);
    const first = sessionOf(org);
    wacalls.expire(first);
    await expect.poll(async () => (await state(owner.cookie)).failure).toBe("qr_expired");
    expect(await notices(org)).toContain("A conexão da ligação pelo WhatsApp não foi concluída: o QR Code não foi lido a tempo. Tente de novo em Configurações.");
    wacalls.requests.length = 0;
    expect((await start(owner.cookie)).data).toMatchObject({ status: "qr" });
    const paths = wacalls.requests.filter((request) => request.path !== "/api/events").map((request) => `${request.method} ${request.path}`);
    expect(paths).toContain(`DELETE /api/sessions/${first.id}`);
    expect(paths).toContain("POST /api/sessions");
    expect(paths.some((path) => path.endsWith("/pair"))).toBe(false);
  });

  it("the phone unlinked the device: failed, with the 14-day hint in the notice and a warning health line", async () => {
    const { org, owner } = await upOrg("calls dropped");
    await start(owner.cookie);
    wacalls.scan(sessionOf(org));
    await state(owner.cookie);
    panel.clock.at = new Date(NOW.getTime() + 60_000);
    wacalls.unlink(sessionOf(org));
    expect(await healthLine(owner.cookie)).toMatchObject({ status: "warn", reason: "whatsapp_calls_dropped" });
    expect(await state(owner.cookie)).toMatchObject({ status: "failed", failure: "logged_out", phone: "+553133330000" });
    expect((await notices(org)).filter((body) => body.includes("mais de 14 dias sem uso"))).toHaveLength(1);
  });

  it("disconnect logs out and deletes the session, and names who did it", async () => {
    const { org, owner } = await upOrg("calls disconnect");
    await start(owner.cookie);
    wacalls.scan(sessionOf(org));
    await state(owner.cookie);
    const id = sessionOf(org).id;
    wacalls.requests.length = 0;
    expect((await call(disconnect, { method: "POST", cookie: owner.cookie })).data).toMatchObject({ status: "disconnected", phone: null });
    const paths = wacalls.requests.map((request) => `${request.method} ${request.path}`);
    expect(paths.indexOf(`POST /api/sessions/${id}/logout`)).toBeLessThan(paths.indexOf(`DELETE /api/sessions/${id}`));
    expect(wacalls.byName(`deskvoice_${org}`)).toBeUndefined();
    expect(await notices(org)).toContain("Ligação pelo WhatsApp: número +553133330000 desconectado por Test owner.");
  });

  it("removing is refused with a number connected; without one, the leftover session is undone first", async () => {
    const { org, owner } = await upOrg("calls remove");
    await start(owner.cookie);
    expect(refusal(await wantService(owner.cookie, false))).toEqual([409, "whatsapp_calls_connected"]);
    wacalls.scan(sessionOf(org));
    await state(owner.cookie);
    expect(refusal(await wantService(owner.cookie, false))).toEqual([409, "whatsapp_calls_connected"]);
    wacalls.unlink(sessionOf(org));
    expect((await state(owner.cookie)).status).toBe("failed");
    expect((await wantService(owner.cookie, false)).data).toMatchObject({ service: "removing", status: "disconnected", phone: null });
    expect(wacalls.byName(`deskvoice_${org}`)).toBeUndefined();
  });

  it("a session left in the volume by an earlier install is undone, instead of a number connected without the screen saying so", async () => {
    const { org, owner } = await upOrg("calls stray");
    await start(owner.cookie);
    wacalls.scan(sessionOf(org));
    await withOrg(panel.app, org, (q) => q.exec("update whatsapp_call_sessions set status = 'disconnected'"));
    expect(await state(owner.cookie)).toMatchObject({ status: "disconnected" });
    expect(wacalls.byName(`deskvoice_${org}`)).toBeUndefined();
  });
});

describe("when something does not answer", () => {
  it("WaCalls down: the screen gets a clear error, the saved state is kept, and the health line warns", async () => {
    const { org, owner } = await upOrg("calls down");
    await start(owner.cookie);
    wacalls.scan(sessionOf(org));
    await state(owner.cookie);
    wacalls.state.down = true;
    expect(refusal(await call(read, { cookie: owner.cookie }))).toEqual([502, "whatsapp_calls_service_down"]);
    expect(await healthLine(owner.cookie)).toMatchObject({ status: "warn", reason: "whatsapp_calls_service_down" });
    wacalls.state.down = false;
    expect(await state(owner.cookie)).toMatchObject({ status: "connected" });
  });

  it("a voice process without the WaCalls token says the installation lacks the key", async () => {
    const { owner } = await upOrg("calls no token");
    await start(owner.cookie);
    const configured = channel;
    channel = createWhatsAppCalls({ token: "", baseUrl: wacalls.options.baseUrl }, { schedule: manualTime().schedule, log: silentLogger });
    try {
      expect(await state(owner.cookie)).toMatchObject({ available: false });
      expect(await healthLine(owner.cookie)).toMatchObject({ status: "warn", reason: "whatsapp_calls_unavailable" });
    } finally {
      channel.close();
      channel = configured;
    }
  });
});
