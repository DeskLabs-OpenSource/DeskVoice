import { afterEach, describe, expect, it } from "vitest";
import { startAudioSocketServer, type AudioSocketCloseReason, type AudioSocketConnection, type AudioSocketServer } from "./audiosocket";
import { audioSocketFrame, fakeAsterisk, manualTime, waitFor, type FakeAsterisk } from "./testing/helpers";

const UUID = "0f3c2a10-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
let server: AudioSocketServer | undefined;
let client: FakeAsterisk | undefined;

afterEach(async () => {
  client?.socket.destroy();
  await server?.close();
  server = undefined;
});

async function open(): Promise<{ time: ReturnType<typeof manualTime>; connections: AudioSocketConnection[]; client: FakeAsterisk }> {
  const time = manualTime();
  const connections: AudioSocketConnection[] = [];
  server = await startAudioSocketServer({ port: 0, host: "127.0.0.1", schedule: time.schedule, now: time.now, onConnection: (c) => void connections.push(c) });
  client = await fakeAsterisk(server.port);
  return { time, connections, client };
}

async function identified(): Promise<{ time: ReturnType<typeof manualTime>; connection: AudioSocketConnection; client: FakeAsterisk }> {
  const { time, connections, client } = await open();
  client.sendUuid(UUID);
  const connection = await waitFor(() => connections[0], "the connection");
  return { time, connection, client };
}

const pcm = (frames: number, fill = 1): Buffer => Buffer.alloc(frames * 320, fill);

describe("servidor AudioSocket", { timeout: 60_000 }, () => {
  it("identifica a chamada pelo UUID do primeiro quadro", async () => {
    const { connection } = await identified();
    expect(connection.id).toBe(UUID);
  });

  it("entrega o áudio de quem ligou, inclusive o que chegou antes de haver quem ouça", async () => {
    const { connection, client } = await identified();
    client.send(0x10, pcm(1, 7));
    client.send(0x10, pcm(1, 8));
    const closed: AudioSocketCloseReason[] = [];
    connection.onClose((reason) => closed.push(reason));
    // O DTMF vem depois do áudio na mesma conexão: quando ele chega, o áudio já chegou.
    const digits: string[] = [];
    connection.onDtmf((digit) => digits.push(digit));
    client.send(0x03, Buffer.from("9"));
    await waitFor(() => digits.length === 1, "the DTMF digit");
    const received: Buffer[] = [];
    connection.onAudio((chunk) => received.push(chunk));
    expect(received.map((chunk) => [chunk.length, chunk[0]])).toEqual([[320, 7], [320, 8]]);
    client.send(0x10, pcm(1, 9));
    await waitFor(() => received.length === 3, "the live frame");
    expect(received[2]?.[0]).toBe(9);
    expect(digits).toEqual(["9"]);
    expect(closed).toEqual([]);
  });

  it("remonta um quadro partido em vários pacotes TCP", async () => {
    const { connection, client } = await identified();
    const received: Buffer[] = [];
    connection.onAudio((chunk) => received.push(chunk));
    const whole = audioSocketFrame(0x10, pcm(1, 3));
    for (const [from, to] of [[0, 1], [1, 2], [2, 100], [100, 323]] as const) {
      client.raw(whole.subarray(from, to));
      await new Promise((resolve) => setImmediate(resolve));
    }
    await waitFor(() => received.length === 1, "the reassembled frame");
    expect(received[0]).toEqual(pcm(1, 3));
  });

  it("separa vários quadros que chegam num pacote só, UUID incluído", async () => {
    const { connections, client } = await open();
    const digits: string[] = [];
    client.raw(
      Buffer.concat([
        audioSocketFrame(0x01, Buffer.from(UUID.replaceAll("-", ""), "hex")),
        audioSocketFrame(0x10, pcm(1, 1)),
        audioSocketFrame(0x10, pcm(1, 2)),
        audioSocketFrame(0x03, Buffer.from("#")),
        audioSocketFrame(0x10, pcm(1, 3)),
      ]),
    );
    const connection = await waitFor(() => connections[0], "the connection");
    const received: number[] = [];
    connection.onDtmf((digit) => digits.push(digit));
    connection.onAudio((chunk) => received.push(chunk[0] ?? -1));
    await waitFor(() => received.length === 3, "three frames");
    expect(received).toEqual([1, 2, 3]);
  });

  it("fecha a conexão diante de quadro de tamanho absurdo, sem entregar nada", async () => {
    const { connection, client } = await identified();
    const reasons: AudioSocketCloseReason[] = [];
    const received: Buffer[] = [];
    connection.onAudio((chunk) => received.push(chunk));
    connection.onClose((reason) => reasons.push(reason));
    client.raw(Buffer.from([0x10, 0xff, 0xff, 1, 2, 3]));
    await waitFor(() => client.closed, "the server to close the connection");
    expect(reasons).toEqual(["protocol_error"]);
    expect(received).toEqual([]);
  });

  it("fecha a conexão cujo primeiro quadro não é um UUID de 16 bytes", async () => {
    const { connections, client } = await open();
    client.send(0x10, pcm(1));
    await waitFor(() => client.closed, "the server to close the connection");
    expect(connections).toEqual([]);
  });

  it("fecha a conexão que nunca se identifica", async () => {
    const { time, connections, client } = await open();
    await waitFor(() => time.pending() === 1, "the handshake timer");
    time.advance(5000);
    await waitFor(() => client.closed, "the server to close the connection");
    expect(connections).toEqual([]);
  });

  it("avisa uma vez só quando o Asterisk desliga (quadro de desligar seguido do fim do TCP)", async () => {
    const { connection, client } = await identified();
    const reasons: AudioSocketCloseReason[] = [];
    connection.onClose((reason) => reasons.push(reason));
    client.hangup();
    await waitFor(() => client.closed, "the socket to close");
    await new Promise((resolve) => setImmediate(resolve));
    expect(reasons).toEqual(["hangup"]);
    // Registrado depois do fechamento, o handler ainda fica sabendo.
    connection.onClose((reason) => reasons.push(reason));
    expect(reasons).toEqual(["hangup", "hangup"]);
  });

  it("avisa quando a conexão cai sem aviso", async () => {
    const { connection, client } = await identified();
    const reasons: AudioSocketCloseReason[] = [];
    connection.onClose((reason) => reasons.push(reason));
    client.socket.destroy();
    await waitFor(() => reasons.length > 0, "the close notice");
    expect(reasons).toEqual(["closed"]);
  });

  it("solta a fala na cadência de 20 ms por quadro, e não de uma vez", async () => {
    const { time, connection, client } = await identified();
    // 5 quadros e meio, entregues em pedaços de tamanho torto, como um motor de voz entrega.
    const speech = Buffer.concat([pcm(5, 4), Buffer.alloc(160, 4)]);
    connection.sendAudio(speech.subarray(0, 500));
    connection.sendAudio(speech.subarray(500));
    const audio = (): number => client.frames.filter((frame) => frame.type === 0x10).length;

    await waitFor(() => audio() === 1, "the first frame");
    for (let expected = 2; expected <= 5; expected++) {
      time.advance(20);
      await waitFor(() => audio() === expected, `frame ${expected}`);
    }
    // Atraso do processo não vira rajada: 60 ms de engasgo soltam no máximo o que o relógio deve.
    expect(audio()).toBe(5);

    let drained = false;
    void connection.drained().then(() => (drained = true));
    time.advance(20); // sobra de meio quadro e nada novo em 20 ms: sai completada com silêncio
    await waitFor(() => audio() === 6, "the padded last frame");
    const last = client.frames.at(-1)?.payload;
    expect(last?.length).toBe(320);
    expect(last?.subarray(0, 160).every((byte) => byte === 4)).toBe(true);
    expect(last?.subarray(160).every((byte) => byte === 0)).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(drained).toBe(false); // o último quadro ainda está tocando
    time.advance(20);
    await waitFor(() => drained, "drained");
    expect(time.pending()).toBe(0);
  });

  it("depois de um engasgo solta no máximo 3 quadros de uma vez", async () => {
    const { time, connection, client } = await identified();
    connection.sendAudio(pcm(20));
    await waitFor(() => client.frames.length === 1, "the first frame");
    time.stall(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.frames.length).toBe(1 + 3);
    // E volta à cadência normal, sem cobrar o atraso depois.
    time.advance(20);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.frames.length).toBe(1 + 3 + 1);
  });

  it("clearAudio descarta o que ainda não saiu", async () => {
    const { time, connection, client } = await identified();
    connection.sendAudio(pcm(50));
    await waitFor(() => client.frames.length === 1, "the first frame");
    time.advance(20);
    await waitFor(() => client.frames.length === 2, "the second frame");
    connection.clearAudio();
    time.advance(1000);
    await connection.drained();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.frames.length).toBe(2);
    // E a fala seguinte sai normalmente.
    connection.sendAudio(pcm(1, 6));
    await waitFor(() => client.frames.length === 3, "the next speech");
    expect(client.frames[2]?.payload[0]).toBe(6);
  });

  it("close() fecha o TCP sem mandar quadro de desligar, e não dispara onClose em dobro", async () => {
    const { connection, client } = await identified();
    const reasons: AudioSocketCloseReason[] = [];
    connection.onClose((reason) => reasons.push(reason));
    connection.sendAudio(pcm(10));
    connection.close();
    connection.close();
    await waitFor(() => client.closed, "the socket to close");
    await connection.drained();
    expect(reasons).toEqual(["local"]);
    expect(client.frames.some((frame) => frame.type === 0x00)).toBe(false);
  });
});
