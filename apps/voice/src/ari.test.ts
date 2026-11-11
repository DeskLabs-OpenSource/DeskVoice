import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { createAriClient, dialString, type AriClient, type AriEvent } from "./ari";
import { waitFor } from "./testing/helpers";

interface Recorded {
  method: string;
  url: string;
  authorization: string | undefined;
  body: unknown;
}

let http: Server | undefined;
let client: AriClient | undefined;

afterEach(async () => {
  client?.close();
  http?.closeAllConnections();
  await new Promise((resolve) => http?.close(resolve) ?? resolve(undefined));
});

/** Um Asterisk falso: REST e WebSocket de eventos na mesma porta, como a ARI de verdade. */
async function fakeAsterisk(respond: (request: Recorded) => { status: number; body?: unknown } = () => ({ status: 204 })) {
  const requests: Recorded[] = [];
  const sockets: WebSocket[] = [];
  const upgrades: string[] = [];
  http = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const recorded = { method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined };
      requests.push(recorded);
      const { status, body } = respond(recorded);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    });
  });
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (socket, req) => {
    sockets.push(socket);
    upgrades.push(req.url ?? "");
  });
  await new Promise<void>((resolve) => http?.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;
  // Reconexão sem esperar tempo real: o recuo pedido fica registrado e o timer roda na hora.
  const delays: number[] = [];
  client = createAriClient({
    url: `http://127.0.0.1:${port}`,
    app: "deskvoice",
    username: "deskvoice",
    password: "s3nha",
    schedule: (fn, delayMs) => {
      delays.push(delayMs);
      const timer = setImmediate(fn);
      return () => clearImmediate(timer);
    },
  });
  return { requests, sockets, upgrades, delays, client };
}

describe("cliente ARI", { timeout: 60_000 }, () => {
  it("fala REST com autenticação básica e a forma que a ARI espera", async () => {
    const { requests, client } = await fakeAsterisk((request) => (request.method === "GET" ? { status: 200, body: [{ resource: "trunk-a", state: "online", technology: "PJSIP" }] } : { status: 204 }));
    await client.setVariable("chan 1", "AUDIOSOCKET_UUID", "abc");
    await client.continueDialplan("chan-1", "deskvoice-audio", "s");
    await client.originate({ endpoint: dialString("+5531999998888", "t1"), context: "deskvoice-audio", extension: "s", channelId: "call-1", callerId: "+553133334444", variables: { AUDIOSOCKET_UUID: "call-1" } });
    await client.reloadModule("res_pjsip.so");
    expect(await client.listEndpoints("PJSIP")).toEqual([{ resource: "trunk-a", state: "online" }]);

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST /ari/channels/chan%201/variable?variable=AUDIOSOCKET_UUID&value=abc",
      "POST /ari/channels/chan-1/continue",
      "POST /ari/channels",
      "PUT /ari/asterisk/modules/res_pjsip.so",
      "GET /ari/endpoints/PJSIP",
    ]);
    expect(requests[0]?.authorization).toBe(`Basic ${Buffer.from("deskvoice:s3nha").toString("base64")}`);
    expect(requests[1]?.body).toEqual({ context: "deskvoice-audio", extension: "s", priority: 1 });
    expect(requests[2]?.body).toEqual({
      endpoint: "PJSIP/5531999998888@trunk-t1",
      context: "deskvoice-audio",
      extension: "s",
      priority: 1,
      channelId: "call-1",
      callerId: "+553133334444",
      timeout: 45,
      variables: { AUDIOSOCKET_UUID: "call-1" },
    });
  });

  it("erro da ARI vira exceção com o status; desligar canal que já sumiu não é erro", async () => {
    const { client } = await fakeAsterisk((request) => (request.method === "DELETE" ? { status: 404, body: { message: "Channel not found" } } : { status: 500, body: { message: "boom" } }));
    await expect(client.hangup("gone")).resolves.toBeUndefined();
    await expect(client.reloadModule("res_pjsip.so")).rejects.toThrow(/answered 500.*boom/);
  });

  it("entrega os eventos, ignora o que não é evento e reconecta quando a escuta cai", async () => {
    const { sockets, upgrades, delays, client } = await fakeAsterisk();
    const events: AriEvent[] = [];
    let connections = 0;
    client.onEvent((event) => events.push(event));
    client.onConnected(() => (connections += 1));
    expect(client.status().connected).toBe(false);
    client.start();

    const first = await waitFor(() => sockets[0], "the events socket");
    await waitFor(() => client.status().connected, "connected status");
    expect(upgrades[0]).toBe("/ari/events?app=deskvoice&api_key=deskvoice%3As3nha&subscribeAll=true");
    first.send("isto não é JSON");
    first.send(JSON.stringify({ no: "type" }));
    first.send(JSON.stringify({ type: "StasisStart", args: ["inbound"], channel: { id: "c1", name: "PJSIP/trunk-x-0001", dialplan: { exten: "s" }, caller: { number: "31999998888" }, extra: 1 } }));
    await waitFor(() => events.length === 1, "the event");
    expect(events[0]).toEqual({ type: "StasisStart", args: ["inbound"], channel: { id: "c1", name: "PJSIP/trunk-x-0001", dialplan: { exten: "s" }, caller: { number: "31999998888" } } });

    first.terminate();
    await waitFor(() => sockets.length === 2 && client.status().connected, "the reconnection");
    expect(connections).toBe(2);
    expect(delays).toEqual([1000]);
  });

  it("sem Asterisk no ar não lança: fica tentando, com recuo crescente, e a situação diz o motivo", async () => {
    const delays: number[] = [];
    const pending: Array<() => void> = [];
    client = createAriClient({ url: "http://127.0.0.1:1", app: "deskvoice", username: "u", password: "p", schedule: (fn, delayMs) => (delays.push(delayMs), pending.push(fn), () => undefined) });
    client.start();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await waitFor(() => pending.length === attempt, `attempt ${attempt} to fail`);
      pending[attempt - 1]?.();
    }
    await waitFor(() => pending.length === 4, "the fourth retry");
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
    expect(client.status()).toEqual({ connected: false, detail: expect.stringMatching(/Asterisk.*not reachable.*ECONNREFUSED/) });
  });
});
