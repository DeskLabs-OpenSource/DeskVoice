import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "./log";
import { WACALLS_TOKEN, startFakeWacalls } from "./testing/fake-wacalls";
import { manualTime, waitFor } from "./testing/helpers";
import { phoneOfJid, wacallsSessionName } from "./wacalls-client";
import { createWhatsAppCalls, type WhatsAppCallsState } from "./whatsapp-calls";

// Dois ids com os mesmos 8 primeiros caracteres: o nome da sessão precisa do id inteiro.
const ORG = "11111111-1111-4111-8111-111111111111";
const NEIGHBOR = "11111111-9999-4999-8999-999999999999";

const wacalls = await startFakeWacalls();
afterAll(() => wacalls.stop());

let channel: ReturnType<typeof createWhatsAppCalls>;
let time: ReturnType<typeof manualTime>;
beforeEach(() => {
  wacalls.sessions.clear();
  wacalls.requests.length = 0;
  wacalls.state.down = false;
  wacalls.state.nextId = 1;
  time = manualTime();
  channel = createWhatsAppCalls(wacalls.options, { schedule: time.schedule, log: silentLogger });
});
afterEach(() => channel.close());

const session = (result: WhatsAppCallsState | { code: string }) => ("session" in result ? result.session : result);
const paths = (): string[] => wacalls.requests.filter((request) => request.path !== "/api/events").map((request) => `${request.method} ${request.path}`);
const ours = () => {
  const found = wacalls.byName(wacallsSessionName(ORG));
  if (!found) throw new Error("no session for the organization");
  return found;
};

describe("ligação pelo WhatsApp: parear pelo processo de voz", { timeout: 30_000 }, () => {
  it("conectar cria a sessão com o id inteiro da organização, e o QR Code que saiu antes do id não se perde", async () => {
    const connected = session(await channel.connect({ organizationId: ORG }));
    expect(connected).toEqual({ id: "s1", status: "qr", qr: "QR-s1-1", phone: null });
    expect(wacalls.byName(`deskvoice_${ORG}`)).toBeDefined();
    expect(paths()).toEqual(["GET /api/sessions", "POST /api/sessions", "GET /api/sessions"]);
  });

  it("o código novo chega pelo SSE, e a leitura vira número conectado", async () => {
    await channel.connect({ organizationId: ORG });
    wacalls.nextQr(ours());
    await waitFor(async () => (session(await channel.state({ organizationId: ORG })) as { qr: string }).qr === "QR-s1-2", "the second code");
    wacalls.scan(ours(), "5531999998888");
    expect(session(await channel.state({ organizationId: ORG }))).toEqual({ id: "s1", status: "connected", qr: null, phone: "+5531999998888" });
  });

  it("a organização vizinha, com o mesmo começo de id, não vê o código da outra", async () => {
    await channel.connect({ organizationId: ORG });
    expect(session(await channel.state({ organizationId: NEIGHBOR }))).toBeNull();
  });

  it("o token vai sempre no cabeçalho, nunca no endereço", async () => {
    await channel.connect({ organizationId: ORG });
    await channel.disconnect({ organizationId: ORG });
    expect(wacalls.requests.length).toBeGreaterThan(3);
    for (const request of wacalls.requests) {
      expect(request.authorization).toBe(`Bearer ${WACALLS_TOKEN}`);
      expect(request.query).toBe("");
    }
  });

  it("código vencido: a tela fica sabendo, e conectar de novo apaga e cria, sem nunca chamar a rota de re-parear", async () => {
    await channel.connect({ organizationId: ORG });
    wacalls.expire(ours());
    await waitFor(async () => (session(await channel.state({ organizationId: ORG })) as { status: string }).status === "logged_out", "the expired code");
    wacalls.requests.length = 0;
    expect(session(await channel.connect({ organizationId: ORG }))).toMatchObject({ id: "s2", status: "qr", qr: "QR-s2-1" });
    expect(paths()).toEqual(["GET /api/sessions", "DELETE /api/sessions/s1", "POST /api/sessions", "GET /api/sessions"]);
    expect(wacalls.requests.some((request) => request.path.endsWith("/pair"))).toBe(false);
  });

  it("com o número já conectado, conectar de novo não mexe em nada", async () => {
    await channel.connect({ organizationId: ORG });
    wacalls.scan(ours());
    wacalls.requests.length = 0;
    expect(session(await channel.connect({ organizationId: ORG }))).toMatchObject({ status: "connected", phone: "+553133330000" });
    expect(paths()).toEqual(["GET /api/sessions"]);
  });

  it("aparelho desvinculado pelo celular: o JID que ficou não conta como conectado", async () => {
    await channel.connect({ organizationId: ORG });
    wacalls.scan(ours());
    wacalls.unlink(ours());
    expect(session(await channel.state({ organizationId: ORG }))).toMatchObject({ status: "logged_out", phone: null });
  });

  it("desconectar sai da sessão pareada e depois a apaga", async () => {
    await channel.connect({ organizationId: ORG });
    wacalls.scan(ours());
    wacalls.requests.length = 0;
    expect(await channel.disconnect({ organizationId: ORG })).toEqual({ session: null });
    expect(paths()).toEqual(["GET /api/sessions", "POST /api/sessions/s1/logout", "DELETE /api/sessions/s1"]);
    expect(wacalls.sessions.size).toBe(0);
  });

  it("sem token, recusa sem falar com ninguém", async () => {
    const bare = createWhatsAppCalls({ token: "", baseUrl: wacalls.options.baseUrl }, { schedule: time.schedule, log: silentLogger });
    expect(await bare.connect({ organizationId: ORG })).toMatchObject({ code: "wacalls_not_configured" });
    expect(await bare.state({ organizationId: ORG })).toMatchObject({ code: "wacalls_not_configured" });
    expect(wacalls.requests).toEqual([]);
    bare.close();
  });

  it("com o serviço fora do ar, diz que não alcança, em vez de dizer que não há número", async () => {
    wacalls.state.down = true;
    expect(await channel.state({ organizationId: ORG })).toMatchObject({ code: "wacalls_refused" });
    const nowhere = createWhatsAppCalls({ token: WACALLS_TOKEN, baseUrl: "http://127.0.0.1:1" }, { schedule: time.schedule, log: silentLogger });
    expect(await nowhere.state({ organizationId: ORG })).toMatchObject({ code: "wacalls_unreachable" });
    nowhere.close();
  });

  it("o SSE cai e volta com espera crescente, e o código seguinte chega", async () => {
    await channel.connect({ organizationId: ORG });
    await waitFor(() => wacalls.streams() === 1, "the events stream");
    wacalls.dropStreams();
    await waitFor(() => time.pending() === 1, "the retry to be scheduled");
    time.advance(999);
    expect(wacalls.streams()).toBe(0);
    time.advance(1);
    await waitFor(() => wacalls.streams() === 1, "the events stream again");
    wacalls.nextQr(ours());
    await waitFor(async () => (session(await channel.state({ organizationId: ORG })) as { qr: string }).qr === "QR-s1-2", "the code after reconnecting");
  });

  it("o telefone sai do JID com aparelho; número oculto (@lid) não é telefone", () => {
    expect(phoneOfJid("5531999998888:12@s.whatsapp.net")).toBe("+5531999998888");
    expect(phoneOfJid("5531999998888@s.whatsapp.net")).toBe("+5531999998888");
    expect(phoneOfJid("123456789@lid")).toBeNull();
    expect(phoneOfJid("")).toBeNull();
  });
});
