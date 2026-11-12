import { withOrg, withSystem } from "@deskvoice/core";
import { wahaSessionName } from "@deskvoice/tools/waha";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { QR_PNG, WAHA_KEY, startFakeWaha } from "../../../../../../packages/tools/test/fake-waha";
import { AGENT_TOKEN, NOW, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import type { WhatsAppView } from "../../../server/whatsapp";
import { GET as readSetting, PUT as writeSetting } from "./settings/[key]/route";
import { POST as agent } from "./system/agent/route";
import { POST as connect } from "./whatsapp/connect/route";
import { POST as disconnect } from "./whatsapp/disconnect/route";
import { GET as read } from "./whatsapp/route";
import { POST as service } from "./whatsapp/service/route";
import { POST as sendTest } from "./whatsapp/test/route";

const panel = startPanel();
const waha = await startFakeWaha();
beforeEach(() => {
  panel.clock.at = NOW;
  panel.deps.waha = waha.options;
  waha.sent.length = 0;
  waha.requests.length = 0;
  waha.contacts.clear();
});
afterAll(async () => {
  await waha.stop();
  await panel.close();
});

type Person = Awaited<ReturnType<typeof createUser>>;
/** O agente do servidor fala com o painel, contando (ou não) o estado do serviço de WhatsApp. */
const agentSays = (whatsapp?: unknown) => call(agent, { method: "POST", body: { version: "0.3.0", ...(whatsapp !== undefined && { whatsapp }) }, headers: { authorization: `Bearer ${AGENT_TOKEN}` } });
const wantService = (cookie: string, wanted: boolean) => call(service, { method: "POST", cookie, body: { wanted } });
/** Organização com dono, sem o serviço pedido; o agente já contou que o serviço não existe no servidor. */
const bareOrg = async (label: string): Promise<{ org: string; owner: Person; session: string }> => {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  await agentSays({ state: "absent" });
  return { org, owner, session: wahaSessionName(org) };
};
/** Organização que pediu o serviço, com o agente já tendo subido o WAHA. É o ponto de partida de quem vai conectar. */
const newOrg = async (label: string): Promise<{ org: string; owner: Person; session: string }> => {
  const created = await bareOrg(label);
  await wantService(created.owner.cookie, true);
  await agentSays({ state: "running" });
  return created;
};
const state = async (cookie: string): Promise<WhatsAppView> => (await call(read, { cookie })).data as WhatsAppView;
const start = (cookie: string, body: unknown = {}) => call(connect, { method: "POST", cookie, body });
const allNotices = async (org: string): Promise<string[]> =>
  (await withOrg(panel.app, org, (q) => q.many<{ body: string }>("select body from notifications where channel = 'panel' order by created_at, id"))).map((row) => row.body);
/** Os avisos da conexão do número. Os do serviço (instalar, remover) têm teste próprio. */
const notices = async (org: string): Promise<string[]> => (await allNotices(org)).filter((body) => !body.includes("serviço de WhatsApp"));
const connector = (org: string) => withOrg(panel.app, org, (q) => q.one<{ value: unknown; secret: boolean }>("select value, secret from settings where key = 'whatsapp.connector'"));
const setWhatsapp = (org: string, userId: string, e164: string) => withOrg(panel.app, org, (q) => q.exec("update users set whatsapp_e164 = $2 where id = $1", [userId, e164]));
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];
const wahaCalls = (): string[] => waha.requests.map((request) => `${request.method} ${request.path}`);
/** A pessoa lê o QR Code no celular. */
const scan = (session: string, digits = "553133330000"): void => waha.connect(session, digits);
/** Organização já conectada, com o aviso de conexão criado. */
const connectedOrg = async (label: string) => {
  const created = await newOrg(label);
  await start(created.owner.cookie);
  scan(created.session);
  await state(created.owner.cookie);
  // O que vem depois acontece mais tarde: os avisos saem em ordem de data.
  panel.clock.at = new Date(panel.clock.at.getTime() + 60_000);
  return created;
};

describe("who can use the WhatsApp block", () => {
  it("answers nobody without a panel session: the QR code is never served to a stranger", async () => {
    const { owner } = await newOrg("wa anonymous");
    await start(owner.cookie);
    waha.requests.length = 0;
    for (const [handler, method] of [[read, "GET"], [connect, "POST"], [disconnect, "POST"], [sendTest, "POST"], [service, "POST"]] as const) {
      const result = await call(handler, { method, ...(method === "POST" && { body: { wanted: true } }) });
      expect(refusal(result), method).toEqual([401, "unauthenticated"]);
      expect(result.text).not.toContain(QR_PNG);
    }
    expect(waha.requests).toEqual([]);
  });

  it("refuses an operator on every route, before anything reaches WAHA", async () => {
    const { org, owner, session } = await newOrg("wa operator");
    await start(owner.cookie);
    scan(session);
    await state(owner.cookie);
    const operator = await createUser(panel.app, org, "operator");
    waha.requests.length = 0;
    for (const [handler, method] of [[read, "GET"], [connect, "POST"], [disconnect, "POST"], [sendTest, "POST"], [service, "POST"]] as const) {
      expect(refusal(await call(handler, { method, cookie: operator.cookie, ...(method === "POST" && { body: { wanted: false } }) })), method).toEqual([403, "forbidden"]);
    }
    expect(waha.requests).toEqual([]);
    expect(await state(owner.cookie)).toMatchObject({ service: "running", status: "connected" });
  });

  it("lets an admin connect", async () => {
    const { org } = await newOrg("wa admin");
    const admin = await createUser(panel.app, org, "admin");
    expect((await start(admin.cookie)).status).toBe(200);
  });
});

describe("connecting by QR code", () => {
  it("before anyone connects, no session exists in WAHA: the panel only looks, and creates nothing", async () => {
    const { owner, session } = await newOrg("wa idle");
    expect(await state(owner.cookie)).toEqual({
      available: true, service: "running", serviceReason: null, serviceWarning: null, disk: null, agent: "responding",
      status: "disconnected", failure: null, phone: null, connectedAt: null, qr: null, replaces: null,
    });
    expect(wahaCalls()).toEqual([`GET /api/sessions/${session}`]);
    expect(waha.sessions.has(session)).toBe(false);
  });

  it("a session that WAHA resumed while the panel says disconnected is undone, instead of a number sending without the screen saying so", async () => {
    const { org, owner, session } = await newOrg("wa stray");
    // O pareamento mora num volume que sobrevive à remoção do serviço: reinstalado, o WAHA retoma.
    waha.connect(session, "553133330000");
    expect(await state(owner.cookie)).toMatchObject({ status: "disconnected", phone: null });
    expect(wahaCalls()).toEqual([`GET /api/sessions/${session}`, `POST /api/sessions/${session}/logout`, `POST /api/sessions/${session}/stop`]);
    expect(waha.sessions.get(session)).toMatchObject({ status: "STOPPED", me: null });
    expect(await connector(org)).toBeNull();
    waha.requests.length = 0;
    await state(owner.cookie);
    expect(wahaCalls()).toEqual([`GET /api/sessions/${session}`]);
  });

  it("says the service is not available on an installation without the WAHA key, and refuses to connect", async () => {
    const { org, owner } = await newOrg("wa no key");
    panel.deps.waha = { apiKey: "" };
    expect((await state(owner.cookie)).available).toBe(false);
    expect(refusal(await start(owner.cookie))).toEqual([409, "whatsapp_unavailable"]);
    expect(await connector(org)).toBeNull();
  });

  it("creates the session, makes the connected number the connector and serves the QR code from the panel itself", async () => {
    const { org, owner, session } = await newOrg("wa connect");
    const result = await start(owner.cookie);
    expect(result.data).toMatchObject({ available: true, status: "qr", qr: `data:image/png;base64,${QR_PNG}`, phone: null, replaces: null });
    expect(waha.sessions.get(session)).toMatchObject({ status: "SCAN_QR_CODE", config: { ignore: { status: true, groups: true, channels: true, broadcast: true } } });
    expect(await connector(org)).toEqual({ value: { type: "waha" }, secret: false });
    // O navegador nunca recebe a chave nem o endereço do WAHA.
    for (const text of [result.text, (await call(read, { cookie: owner.cookie })).text, (await call(readSetting, { cookie: owner.cookie, params: { key: "whatsapp.connector" } })).text]) {
      expect(text).not.toContain(WAHA_KEY);
      expect(text).not.toContain(waha.baseUrl);
      expect(text).not.toContain("waha:3000");
    }
    expect(await notices(org)).toEqual([]);
  });

  it("once the code is read: shows the number and since when, and leaves one notice however many times the screen asks", async () => {
    const { org, owner, session } = await newOrg("wa scanned");
    await start(owner.cookie);
    scan(session, "5531988887777");
    panel.clock.at = new Date(NOW.getTime() + 30_000);
    const [first, second] = await Promise.all([state(owner.cookie), state(owner.cookie)]);
    expect(first).toMatchObject({ status: "connected", phone: "+5531988887777", qr: null });
    expect(second).toMatchObject({ status: "connected", phone: "+5531988887777" });
    expect((await state(owner.cookie)).connectedAt).toBe(panel.clock.at.toISOString());
    expect(await notices(org)).toEqual(["WhatsApp conectado: +5531988887777. Os avisos e as mensagens do agente passam a sair por este número."]);
  });

  it("warns before replacing a connector that was already configured, and replaces only with the confirmation", async () => {
    const { org, owner } = await newOrg("wa replace");
    await call(writeSetting, { method: "PUT", cookie: owner.cookie, params: { key: "whatsapp.connector" }, body: { value: { type: "webhook", url: "https://wa.example.com/send", token: "old-token" } } });
    expect((await state(owner.cookie)).replaces).toEqual({ type: "webhook", url: "https://wa.example.com/send" });

    waha.requests.length = 0;
    expect(refusal(await start(owner.cookie))).toEqual([409, "connector_replace_required"]);
    expect(waha.requests).toEqual([]);
    expect((await connector(org))?.value).toMatchObject({ type: "webhook" });

    expect((await start(owner.cookie, { replace: true })).data).toMatchObject({ status: "qr", replaces: null });
    expect((await connector(org))?.value).toEqual({ type: "waha" });
  });

  it("does not let the connector be swapped or removed underneath a connected number", async () => {
    const { org, owner } = await connectedOrg("wa guard");
    const put = (value: unknown) => call(writeSetting, { method: "PUT", cookie: owner.cookie, params: { key: "whatsapp.connector" }, body: { value } });
    expect(refusal(await put({ type: "webhook", url: "https://wa.example.com/send", token: "t" }))).toEqual([409, "whatsapp_connected"]);
    expect(refusal(await put(null))).toEqual([409, "whatsapp_connected"]);
    // O tipo `waha` não se grava pela rota de configurações, com ou sem endereço.
    const other = await bareOrg("wa guard b");
    expect(refusal(await call(writeSetting, { method: "PUT", cookie: other.owner.cookie, params: { key: "whatsapp.connector" }, body: { value: { type: "waha", url: "https://evil.example.com", token: "t" } } }))).toEqual([400, "validation_error"]);
    expect((await connector(org))?.value).toEqual({ type: "waha" });
    expect((await call(readSetting, { cookie: owner.cookie, params: { key: "whatsapp.connector" } })).data).toEqual({ key: "whatsapp.connector", value: { type: "waha" } });
  });

  it("keeps each organization on its own session", async () => {
    const a = await connectedOrg("wa org a");
    const b = await newOrg("wa org b");
    expect(a.session).not.toBe(b.session);
    expect(await state(b.owner.cookie)).toMatchObject({ status: "disconnected", phone: null });
    expect(await notices(b.org)).toEqual([]);
  });
});

describe("test message", () => {
  it("asks the person to save their own WhatsApp first", async () => {
    const { owner } = await connectedOrg("wa test no contact");
    expect(refusal(await call(sendTest, { method: "POST", cookie: owner.cookie, body: {} }))).toEqual([400, "whatsapp_contact_required"]);
    expect(waha.sent).toEqual([]);
  });

  it("goes to the WhatsApp of whoever is logged in, at the canonical address", async () => {
    const { org, owner, session } = await connectedOrg("wa test ok");
    await setWhatsapp(org, owner.id, "+5531999998888");
    waha.contacts.set("5531999998888", "553199998888@c.us");
    expect((await call(sendTest, { method: "POST", cookie: owner.cookie, body: {} })).data).toEqual({ to: "+5531999998888", addressVerified: true });
    expect(waha.sent).toEqual([{ session, chatId: "553199998888@c.us", text: expect.stringContaining("Mensagem de teste do DeskVoice") as string }]);
  });

  it("is written in the language of the screen of whoever clicked, and only in one of the three fixed texts", async () => {
    const { org, owner } = await connectedOrg("wa test locale");
    await setWhatsapp(org, owner.id, "+5531999998888");
    waha.contacts.set("5531999998888", "553199998888@c.us");
    await call(sendTest, { method: "POST", cookie: owner.cookie, body: { locale: "en" } });
    await call(sendTest, { method: "POST", cookie: owner.cookie, body: { locale: "es" } });
    expect(waha.sent.map((message) => message.text)).toEqual([expect.stringMatching(/^DeskVoice test message\./) as string, expect.stringMatching(/^Mensaje de prueba de DeskVoice\./) as string]);
    expect(refusal(await call(sendTest, { method: "POST", cookie: owner.cookie, body: { locale: "fr", text: "anything" } }))).toEqual([400, "validation_error"]);
    expect(waha.sent).toHaveLength(2);
  });

  it("still goes out, saying the address was not confirmed, when WAHA refuses the address lookup itself", async () => {
    const { org, owner, session } = await connectedOrg("wa test no lookup");
    await setWhatsapp(org, owner.id, "+5531999998888");
    waha.override("GET /api/contacts/check-exists", { status: 400, body: { message: "Enable NOWEB store" } });
    expect((await call(sendTest, { method: "POST", cookie: owner.cookie, body: {} })).data).toEqual({ to: "+5531999998888", addressVerified: false });
    waha.override("GET /api/contacts/check-exists", undefined);
    expect(waha.sent).toEqual([{ session, chatId: "5531999998888@c.us", text: expect.any(String) as string }]);
  });

  it("says so when the number is not on WhatsApp or the session is not connected, and sends nothing", async () => {
    const { org, owner, session } = await connectedOrg("wa test fails");
    await setWhatsapp(org, owner.id, "+5531999998888");
    expect(refusal(await call(sendTest, { method: "POST", cookie: owner.cookie, body: {} }))).toEqual([400, "whatsapp_number_not_found"]);
    const live = waha.sessions.get(session);
    if (live) live.status = "STARTING";
    expect(refusal(await call(sendTest, { method: "POST", cookie: owner.cookie, body: {} }))).toEqual([409, "whatsapp_not_connected"]);
    expect(waha.sent).toEqual([]);
  });
});

describe("disconnecting and failing", () => {
  it("disconnect unpairs first and stops after, removes the connector and leaves a notice naming who did it", async () => {
    const { org, owner, session } = await connectedOrg("wa disconnect");
    waha.requests.length = 0;
    const result = await call(disconnect, { method: "POST", cookie: owner.cookie, body: {} });
    expect(result.data).toMatchObject({ status: "disconnected", phone: null, connectedAt: null, qr: null });
    expect(wahaCalls()).toEqual([`POST /api/sessions/${session}/logout`, `POST /api/sessions/${session}/stop`]);
    expect(waha.sessions.get(session)).toMatchObject({ status: "STOPPED", me: null });
    expect(await connector(org)).toBeNull();
    expect((await notices(org)).at(-1)).toBe("WhatsApp +553133330000 desconectado por Test owner. Os avisos e as mensagens por WhatsApp não saem até um número ser conectado de novo.");
    // Desconectado, o painel só confere que a sessão segue parada.
    waha.requests.length = 0;
    expect((await state(owner.cookie)).status).toBe("disconnected");
    expect(wahaCalls()).toEqual([`GET /api/sessions/${session}`]);
  });

  it("a session that dropped shows as failed with the reason and a notice; connecting again starts from scratch", async () => {
    const { org, owner, session } = await connectedOrg("wa dropped");
    const live = waha.sessions.get(session);
    if (live) live.status = "FAILED";
    expect(await state(owner.cookie)).toMatchObject({ status: "failed", failure: "FAILED", phone: "+553133330000" });
    await state(owner.cookie);
    expect((await notices(org)).slice(1)).toEqual(["O WhatsApp +553133330000 desconectou. Os avisos e as mensagens por WhatsApp não saem até alguém conectar de novo, em Configurações."]);

    waha.requests.length = 0;
    expect((await start(owner.cookie)).data).toMatchObject({ status: "qr", failure: null, qr: expect.any(String) as string });
    expect(wahaCalls().slice(0, 6)).toEqual([
      `GET /api/sessions/${session}`,
      `POST /api/sessions/${session}/stop`,
      `POST /api/sessions/${session}/logout`,
      `GET /api/sessions/${session}`,
      `POST /api/sessions/${session}/start`,
      `GET /api/sessions/${session}`,
    ]);
  });

  it("a session that came back stopped is started again without throwing the pairing away", async () => {
    const { owner, session } = await connectedOrg("wa stopped");
    const live = waha.sessions.get(session);
    if (live) live.status = "STOPPED";
    expect(await state(owner.cookie)).toMatchObject({ status: "failed", failure: "STOPPED" });
    waha.requests.length = 0;
    expect((await start(owner.cookie)).data).toMatchObject({ status: "connected", phone: "+553133330000" });
    expect(wahaCalls()).not.toContain(`POST /api/sessions/${session}/logout`);
  });

  it("a QR code nobody read in time shows as expired, and a session that vanished from WAHA as missing", async () => {
    const { org, owner, session } = await newOrg("wa expired");
    await start(owner.cookie);
    const live = waha.sessions.get(session);
    if (live) live.status = "FAILED";
    expect(await state(owner.cookie)).toMatchObject({ status: "failed", failure: "qr_expired", qr: null });
    expect(await notices(org)).toEqual(["A conexão do WhatsApp não foi concluída: o QR Code não foi lido a tempo ou a conexão falhou. Tente de novo em Configurações."]);

    const gone = await connectedOrg("wa missing");
    waha.sessions.delete(gone.session);
    expect(await state(gone.owner.cookie)).toMatchObject({ status: "failed", failure: "missing" });
  });

  it("when WAHA does not answer, or answers outside the contract, the screen gets a clear error and the saved state is kept", async () => {
    const { owner, session } = await connectedOrg("wa down");
    panel.deps.waha = { apiKey: WAHA_KEY, baseUrl: "http://127.0.0.1:1" };
    expect(refusal(await call(read, { cookie: owner.cookie }))).toEqual([502, "whatsapp_service_down"]);
    panel.deps.waha = waha.options;
    waha.override(`GET /api/sessions/${session}`, { status: 200, body: { name: session, status: "WORKING", me: "not an object" } });
    expect(refusal(await call(read, { cookie: owner.cookie }))).toEqual([502, "whatsapp_service_down"]);
    waha.override(`GET /api/sessions/${session}`, undefined);
    expect((await state(owner.cookie)).status).toBe("connected");
  });
});

describe("the WhatsApp service exists only on the server of whoever asked for it", () => {
  const nobodyWants = () => withSystem(panel.app, (q) => q.exec("update whatsapp_sessions set service_wanted = false"));
  const answer = async (whatsapp?: unknown) => (await agentSays(whatsapp)).data;

  it("by default it is not installed: the screen says so, nothing is asked of WAHA and the agent hears no", async () => {
    await nobodyWants();
    const { owner } = await bareOrg("svc default");
    expect(await state(owner.cookie)).toMatchObject({ available: true, service: "absent", serviceReason: null, agent: "responding", status: "disconnected", qr: null });
    expect(await answer({ state: "absent" })).toEqual({ update: false, whatsapp: false });
    expect(waha.requests).toEqual([]);
  });

  it("refuses to connect a number while the service is not running, without reaching WAHA", async () => {
    const { owner } = await bareOrg("svc connect early");
    expect(refusal(await start(owner.cookie))).toEqual([409, "whatsapp_service_absent"]);
    await wantService(owner.cookie, true);
    expect(refusal(await start(owner.cookie))).toEqual([409, "whatsapp_service_absent"]);
    expect(waha.requests).toEqual([]);
  });

  it("installing only records the wish: the agent hears yes, and the screen follows what the agent tells", async () => {
    await nobodyWants();
    const { org, owner } = await bareOrg("svc install");
    expect((await wantService(owner.cookie, true)).data).toMatchObject({ service: "preparing", agent: "responding" });
    expect(await answer({ state: "absent" })).toEqual({ update: false, whatsapp: true });
    expect((await state(owner.cookie)).service).toBe("preparing");

    panel.clock.at = new Date(NOW.getTime() + 30_000);
    expect(await answer({ state: "failed", reason: "pull_failed" })).toEqual({ update: false, whatsapp: true });
    expect(await state(owner.cookie)).toMatchObject({ service: "failed", serviceReason: "pull_failed" });

    panel.clock.at = new Date(NOW.getTime() + 60_000);
    expect(await answer({ state: "running" })).toEqual({ update: false, whatsapp: true });
    await answer({ state: "running" });
    expect(await state(owner.cookie)).toMatchObject({ service: "running", serviceReason: null, status: "disconnected" });
    expect(await allNotices(org)).toEqual([
      "Test owner pediu a instalação do serviço de WhatsApp neste servidor. O servidor baixa e sobe o serviço em alguns minutos.",
      "O servidor não conseguiu instalar ou remover o serviço de WhatsApp. Ele tenta de novo em alguns minutos; o motivo está em Configurações.",
      "O serviço de WhatsApp está instalado neste servidor. Conecte um número em Configurações.",
    ]);
    // Enquanto o serviço não estava de pé nada foi perguntado ao WAHA; de pé, o painel só olha.
    expect(waha.requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("answers the agent with the two booleans and nothing else, whatever the report says about WhatsApp", async () => {
    await nobodyWants();
    const { owner } = await bareOrg("svc contract");
    await wantService(owner.cookie, true);
    for (const report of [{ state: "running" }, { state: "dancing" }, { state: "failed", reason: "rm -rf /" }, "running", { image: "evil/waha:latest", command: "up" }, undefined]) {
      const result = await agentSays(report);
      expect(JSON.parse(result.text), JSON.stringify(report)).toEqual({ ok: true, data: { update: false, whatsapp: true } });
    }
    // Relato que o painel não entende vale como "o agente não contou": nunca vira estado inventado.
    expect(await state(owner.cookie)).toMatchObject({ service: "preparing", serviceReason: null });
    await agentSays({ state: "failed", reason: "rm -rf /" });
    expect(await state(owner.cookie)).toMatchObject({ service: "failed", serviceReason: null });
  });

  it("says when the agent of the server never spoke or went silent, since the request would wait forever", async () => {
    const { owner } = await bareOrg("svc agent");
    await wantService(owner.cookie, true);
    panel.clock.at = new Date(NOW.getTime() + 6 * 60_000);
    expect(await state(owner.cookie)).toMatchObject({ service: "preparing", agent: "silent" });
    await withSystem(panel.app, (q) => q.exec("delete from update_agent_status"));
    expect(await state(owner.cookie)).toMatchObject({ service: "preparing", agent: "never" });
  });

  it("removing is refused with a number connected; without one, the agent hears no and the screen follows until it is gone", async () => {
    await nobodyWants();
    const { org, owner, session } = await bareOrg("svc remove");
    await wantService(owner.cookie, true);
    await agentSays({ state: "running" });
    await start(owner.cookie);
    expect(refusal(await wantService(owner.cookie, false))).toEqual([409, "whatsapp_connected"]);
    scan(session);
    await state(owner.cookie);
    expect(refusal(await wantService(owner.cookie, false))).toEqual([409, "whatsapp_connected"]);
    expect(await answer({ state: "running" })).toEqual({ update: false, whatsapp: true });

    // A conexão caiu: o conector `waha` ficou gravado. Remover o serviço o leva junto.
    const live = waha.sessions.get(session);
    if (live) live.status = "FAILED";
    expect((await state(owner.cookie)).status).toBe("failed");
    panel.clock.at = new Date(NOW.getTime() + 120_000);
    waha.requests.length = 0;
    expect((await wantService(owner.cookie, false)).data).toMatchObject({ service: "removing", status: "disconnected", phone: null, failure: null });
    expect(await connector(org)).toBeNull();
    // Antes de remover, o pareamento que sobrou no WAHA é desfeito: o volume fica, e sem isso o
    // número voltaria conectado numa reinstalação.
    expect(wahaCalls()).toEqual([`POST /api/sessions/${session}/logout`, `POST /api/sessions/${session}/stop`]);
    expect(waha.sessions.get(session)).toMatchObject({ status: "STOPPED", me: null });
    expect(await answer({ state: "running" })).toEqual({ update: false, whatsapp: false });
    expect((await state(owner.cookie)).service).toBe("removing");
    panel.clock.at = new Date(NOW.getTime() + 180_000);
    expect(await answer({ state: "absent" })).toEqual({ update: false, whatsapp: false });
    expect(await state(owner.cookie)).toMatchObject({ service: "absent", status: "disconnected" });
    expect((await allNotices(org)).slice(-2)).toEqual([
      "Test owner pediu a remoção do serviço de WhatsApp deste servidor. O número fica desconectado, e a memória e o disco são liberados em instantes.",
      "O serviço de WhatsApp foi removido deste servidor.",
    ]);
  });

  it("removing still goes through when WAHA does not answer the logout: it is best effort", async () => {
    const { owner } = await newOrg("svc remove down");
    panel.deps.waha = { apiKey: WAHA_KEY, baseUrl: "http://127.0.0.1:1" };
    expect((await wantService(owner.cookie, false)).data).toMatchObject({ service: "removing", status: "disconnected" });
  });

  it("no disk: the screen gets the closed code and how much there is and how much it takes, as numbers only", async () => {
    await nobodyWants();
    const { owner } = await bareOrg("svc no disk");
    await wantService(owner.cookie, true);
    expect(await answer({ state: "failed", reason: "no_disk", freeDiskMb: 4000, neededDiskMb: 5120 })).toEqual({ update: false, whatsapp: true });
    expect(await state(owner.cookie)).toMatchObject({ service: "failed", serviceReason: "no_disk", disk: { freeMb: 4000, neededMb: 5120 }, serviceWarning: null });
    // Número que não é número, ou fora de um estado de falta de disco, não chega à tela.
    await answer({ state: "failed", reason: "no_disk", freeDiskMb: "4000; rm -rf /", neededDiskMb: -1 });
    expect(await state(owner.cookie)).toMatchObject({ service: "failed", serviceReason: "no_disk", disk: null });
    await answer({ state: "failed", reason: "pull_failed", freeDiskMb: 4000, neededDiskMb: 5120 });
    expect(await state(owner.cookie)).toMatchObject({ serviceReason: "pull_failed", disk: null });
  });

  it("warnings ride along with the state they belong to: low memory with the service up, image kept with it gone", async () => {
    await nobodyWants();
    const { owner } = await bareOrg("svc warnings");
    await wantService(owner.cookie, true);
    await answer({ state: "absent", warning: "low_memory" });
    expect(await state(owner.cookie)).toMatchObject({ service: "preparing", serviceWarning: null });
    await answer({ state: "running", warning: "low_memory" });
    expect(await state(owner.cookie)).toMatchObject({ service: "running", serviceWarning: "low_memory" });
    await answer({ state: "running", warning: "buy more ram at evil.example" });
    expect(await state(owner.cookie)).toMatchObject({ service: "running", serviceWarning: null });

    await wantService(owner.cookie, false);
    await answer({ state: "absent", warning: "image_kept" });
    expect(await state(owner.cookie)).toMatchObject({ service: "absent", serviceWarning: "image_kept" });
    await answer({ state: "absent" });
    expect(await state(owner.cookie)).toMatchObject({ service: "absent", serviceWarning: null });
  });

  it("one organization that wants it is enough for the installation, and an agent that does not tell the service state changes nothing", async () => {
    await nobodyWants();
    const a = await bareOrg("svc two a");
    const b = await bareOrg("svc two b");
    await wantService(a.owner.cookie, true);
    expect(await answer()).toEqual({ update: false, whatsapp: true });
    expect((await state(b.owner.cookie)).service).toBe("absent");
    expect((await state(a.owner.cookie)).service).toBe("preparing");
  });
});

