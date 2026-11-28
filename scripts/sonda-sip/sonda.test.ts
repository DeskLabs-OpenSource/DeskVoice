import { createSocket, type Socket } from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";
import { parseSipMessage, SipProbe, viaSeen } from "./sonda";

/** Uma central de mentira em 127.0.0.1: responde a cada pedido com `answer`, ou não responde. */
async function fakeServer(answer: ((request: string, remote: { address: string; port: number }) => string) | null): Promise<{ socket: Socket; port: number; requests: string[] }> {
  const socket = createSocket("udp4");
  const requests: string[] = [];
  socket.on("message", (buffer, remote) => {
    requests.push(buffer.toString("utf8"));
    if (answer) socket.send(answer(buffer.toString("utf8"), remote), remote.port, remote.address);
  });
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", () => resolve()));
  return { socket, port: socket.address().port, requests };
}

/** A resposta que uma central dá: o Via de volta com o que ela viu (`received`, `rport`). */
const reply =
  (status: string) =>
  (request: string, remote: { address: string; port: number }): string => {
    const { headers } = parseSipMessage(request);
    const via = (headers.get("via")?.[0] ?? "").replace(";rport", `;received=${remote.address};rport=${remote.port}`);
    return [`SIP/2.0 ${status}`, `Via: ${via}`, `From: ${headers.get("from")?.[0]}`, `To: ${headers.get("to")?.[0]};tag=x`, `Call-ID: ${headers.get("call-id")?.[0]}`, "CSeq: 1 OPTIONS", "Content-Length: 0", "", ""].join("\r\n");
  };

const open: Array<{ close(): unknown }> = [];
afterEach(async () => {
  for (const item of open.splice(0)) await item.close();
});

describe("sonda SIP", () => {
  it("manda um OPTIONS, lê o código da resposta e o endereço que a central viu", async () => {
    const server = await fakeServer(reply("403 Forbidden"));
    open.push({ close: () => new Promise<void>((resolve) => server.socket.close(() => resolve())) });
    const probe = await SipProbe.open("127.0.0.1", { targetPort: server.port });
    open.push(probe);
    const answer = await probe.options("127.0.0.1", { port: server.port, user: "trunk-x" });
    expect(answer).toEqual({ answered: true, status: 403, reason: "Forbidden", received: "127.0.0.1", rport: probe.local.port, local: probe.local, callId: expect.stringMatching(/@deskvoice-sonda$/) });
    const sent = parseSipMessage(server.requests[0] ?? "");
    expect(sent.startLine).toBe(`OPTIONS sip:127.0.0.1:${server.port} SIP/2.0`);
    expect(sent.headers.get("from")?.[0]).toMatch(/^<sip:trunk-x@127\.0\.0\.1>;tag=/);
    expect(sent.headers.get("via")?.[0]).toMatch(/;rport$/);
  });

  it("sem resposta no prazo: answered=false, depois de tentar de novo", async () => {
    const server = await fakeServer(null);
    open.push({ close: () => new Promise<void>((resolve) => server.socket.close(() => resolve())) });
    const probe = await SipProbe.open("127.0.0.1", { targetPort: server.port });
    open.push(probe);
    expect(await probe.options("127.0.0.1", { port: server.port, timeoutMs: 1200 })).toEqual({ answered: false, local: probe.local, callId: expect.any(String) });
    expect(server.requests.length).toBeGreaterThan(1);
  });

  it("responde 200 ao OPTIONS que chega (a qualificação da central), com a mesma transação", async () => {
    const probe = await SipProbe.open("127.0.0.1");
    open.push(probe);
    const asker = await fakeServer(null);
    open.push({ close: () => new Promise<void>((resolve) => asker.socket.close(() => resolve())) });
    const got = new Promise<string>((resolve) => asker.socket.once("message", (buffer) => resolve(buffer.toString("utf8"))));
    const request = [
      `OPTIONS sip:${probe.local.address}:${probe.local.port} SIP/2.0`,
      `Via: SIP/2.0/UDP 127.0.0.1:${asker.port};branch=z9hG4bKabc;rport`,
      "From: <sip:asterisk@127.0.0.1>;tag=a1",
      `To: <sip:${probe.local.address}:${probe.local.port}>`,
      "Call-ID: qualify-1",
      "CSeq: 7 OPTIONS",
      "Content-Length: 0",
      "",
      "",
    ].join("\r\n");
    asker.socket.send(request, probe.local.port, probe.local.address);
    const { startLine, headers } = parseSipMessage(await got);
    expect(startLine).toBe("SIP/2.0 200 OK");
    expect(headers.get("call-id")).toEqual(["qualify-1"]);
    expect(headers.get("cseq")).toEqual(["7 OPTIONS"]);
    expect(headers.get("to")?.[0]).toMatch(/;tag=/);
    expect(probe.seen).toEqual([{ method: "OPTIONS", from: { address: "127.0.0.1", port: asker.port } }]);
  });

  it("com line, o pedido leva o parâmetro na URI e no To, como a operadora devolve o Contact do registro", async () => {
    const server = await fakeServer(reply("200 OK"));
    open.push({ close: () => new Promise<void>((resolve) => server.socket.close(() => resolve())) });
    const probe = await SipProbe.open("127.0.0.1", { targetPort: server.port });
    open.push(probe);
    await probe.options("127.0.0.1", { port: server.port, line: "abcdefg" });
    const sent = parseSipMessage(server.requests[0] ?? "");
    expect(sent.startLine).toBe(`OPTIONS sip:127.0.0.1:${server.port};line=abcdefg SIP/2.0`);
    expect(sent.headers.get("to")).toEqual([`<sip:127.0.0.1:${server.port};line=abcdefg>`]);
  });

  it("guarda o line do Contact de um REGISTER que chega, e não responde a ele", async () => {
    const probe = await SipProbe.open("127.0.0.1");
    open.push(probe);
    const asker = await fakeServer(null);
    open.push({ close: () => new Promise<void>((resolve) => asker.socket.close(() => resolve())) });
    const request = [
      `REGISTER sip:${probe.local.address}:${probe.local.port} SIP/2.0`,
      `Via: SIP/2.0/UDP 127.0.0.1:${asker.port};branch=z9hG4bKreg;rport`,
      "From: <sip:sonda@127.0.0.1>;tag=r1",
      "To: <sip:sonda@127.0.0.1>",
      "Call-ID: register-1",
      "CSeq: 1 REGISTER",
      `Contact: <sip:sonda@172.18.0.3:5060;line=qwertyu>`,
      "Content-Length: 0",
      "",
      "",
    ].join("\r\n");
    asker.socket.send(request, probe.local.port, probe.local.address);
    await expect.poll(() => probe.seen).toEqual([{ method: "REGISTER", from: { address: "127.0.0.1", port: asker.port }, line: "qwertyu" }]);
    expect(asker.requests).toEqual([]);
  });

  it("lê received e rport do Via, também com IPv6 entre colchetes", () => {
    expect(viaSeen("SIP/2.0/UDP 10.1.0.5:5099;branch=z9hG4bKx;received=10.1.0.5;rport=5099")).toEqual({ received: "10.1.0.5", rport: 5099 });
    expect(viaSeen("SIP/2.0/UDP [2001:db8::1]:5099;rport=5099;received=[2001:db8::1]")).toEqual({ received: "2001:db8::1", rport: 5099 });
    expect(viaSeen("SIP/2.0/UDP 10.1.0.5:5099;branch=z9hG4bKx")).toEqual({});
  });
});
