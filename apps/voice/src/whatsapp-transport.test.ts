import { resample } from "@deskvoice/voice-engine";
import { afterEach, describe, expect, it } from "vitest";
import { silentLogger } from "./log";
import { answerLikeWacalls, LOOPBACK_PEER, type FakeLeg } from "./testing/fake-wacalls";
import { manualTime, waitFor } from "./testing/helpers";
import { openWhatsAppTransport, type WhatsAppTransport } from "./whatsapp-transport";

// Contrato com o par WebRTC do WaCalls, representado por um par werift que faz o que o pion dele faz
// (`answerLikeWacalls`): responde à oferta e recebe o canal `pcm`, PCM16 mono a 16 kHz.
const FRAME_16K = 640;

function tone(samples: number, rate: number, hz = 400): Buffer {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / rate)), i * 2);
  return pcm;
}
const isSilence = (frame: Buffer): boolean => frame.every((byte) => byte === 0);

const open: Array<{ transport: WhatsAppTransport; leg: FakeLeg }> = [];
afterEach(async () => {
  for (const { transport, leg } of open.splice(0)) {
    await transport.close();
    await leg.connection.close();
  }
});

async function connect() {
  const time = manualTime();
  let leg: FakeLeg | undefined;
  const ends: string[] = [];
  const transport = await openWhatsAppTransport(
    {
      async exchange(offer) {
        const answered = await answerLikeWacalls(offer);
        leg = answered.leg;
        return answered.answer;
      },
      async end() {
        ends.push("DELETE");
      },
    },
    { schedule: time.schedule, now: time.now, log: silentLogger, peerConfig: LOOPBACK_PEER },
  );
  if (!leg) throw new Error("no fake leg");
  const fake = leg;
  open.push({ transport, leg: fake });
  await waitFor(() => fake.channel?.readyState === "open", "the pcm channel to open");
  const heard: Buffer[] = [];
  transport.onAudio((pcm) => heard.push(pcm));
  let hungUp = 0;
  transport.onHangup(() => (hungUp += 1));
  return { time, transport, fake, ends, heard, hungUp: () => hungUp };
}

/** O WaCalls diz `connected`, e o primeiro pedaço (silêncio) atravessa: a contagem parte dele. */
async function started(context: Awaited<ReturnType<typeof connect>>): Promise<void> {
  context.transport.mediaConnected();
  await waitFor(() => context.fake.received.length === 1, "the first frame");
}

/** Anda o relógio de 20 em 20 ms e espera cada pedaço atravessar o loopback. */
async function play(context: Awaited<ReturnType<typeof connect>>, ms: number): Promise<void> {
  const target = context.fake.received.length + ms / 20;
  for (let elapsed = 0; elapsed < ms; elapsed += 20) context.time.advance(20);
  await waitFor(() => context.fake.received.length >= target, `${ms / 20} more frames`);
}

describe("ligação pelo WhatsApp: o transporte contra o par do WaCalls", { timeout: 30_000 }, () => {
  it("o áudio de quem ligou chega a 16 kHz e é entregue à conversa a 8 kHz", async () => {
    const context = await connect();
    const caller = tone(960, 16_000);
    context.fake.channel?.send(caller);
    await waitFor(() => context.heard.length === 1, "the caller audio");
    expect(context.heard[0]).toEqual(resample(caller, 16_000, 8000));
    expect(context.heard[0]).toHaveLength(960);
  });

  it("quem ligou se calou e o celular parou de mandar áudio: a conversa recebe silêncio no lugar, e o detector de turno vê o fim da fala", async () => {
    const context = await connect();
    await started(context);
    const caller = tone(960, 16_000);
    context.fake.channel?.send(caller);
    await waitFor(() => context.heard.length === 1, "the caller audio");
    // Nada chega do celular por 600 ms: depois de 100 ms sem áudio, um pedaço de silêncio a cada 20 ms.
    for (let elapsed = 0; elapsed < 600; elapsed += 20) context.time.advance(20);
    const filled = context.heard.slice(1);
    expect(filled).toHaveLength(26);
    for (const frame of filled) expect(frame.equals(Buffer.alloc(320))).toBe(true);
    // O áudio volta: o silêncio para de ser inventado.
    context.fake.channel?.send(caller);
    await waitFor(() => context.heard.length === 28, "the caller audio again");
    context.time.advance(80);
    expect(context.heard).toHaveLength(28);
  });

  it("nada sai antes de o WaCalls dizer connected: a saudação não se perde no buffer de 240 ms dele", async () => {
    const context = await connect();
    context.transport.sendAudio(tone(1600, 8000));
    context.time.advance(2000);
    // Sem compasso agendado, nada foi nem vai ser escrito no canal.
    expect(context.time.pending()).toBe(0);
    expect(context.fake.received).toEqual([]);
    context.transport.mediaConnected();
    await waitFor(() => context.fake.received.length === 1, "the first frame");
    expect(context.fake.received[0]).toEqual(resample(tone(1600, 8000), 8000, 16_000).subarray(0, FRAME_16K));
  });

  it("a fala sai convertida para 16 kHz, um pedaço de 20 ms por tick do relógio, e nunca adiantada", async () => {
    const context = await connect();
    await started(context);
    // Um segundo de fala entregue de uma vez: se algo saísse adiantado, chegaria antes do último
    // pedaço (o canal é ordenado), e a conta abaixo passaria de 51.
    const speech = tone(8000, 8000);
    context.transport.sendAudio(speech);
    await play(context, 1000);
    expect(context.fake.received).toHaveLength(51);
    for (const frame of context.fake.received) expect(frame).toHaveLength(FRAME_16K);
    expect(Buffer.concat(context.fake.received.slice(1))).toEqual(resample(speech, 8000, 16_000));
  });

  it("enquanto o agente escuta, sai silêncio a cada 20 ms, por mais de 5 s", async () => {
    const context = await connect();
    await started(context);
    await play(context, 6000);
    expect(context.fake.received).toHaveLength(301);
    expect(context.fake.received.every(isSilence)).toBe(true);
  });

  it("o fim de cada fala sai completo, com silêncio atrás, e não fica preso esperando a fala seguinte", async () => {
    const context = await connect();
    await started(context);
    // 25 ms a 8 kHz: um pedaço cheio e um quarto de pedaço.
    context.transport.sendAudio(tone(200, 8000));
    await play(context, 60);
    const [, first, tail, after] = context.fake.received;
    expect(isSilence(first ?? Buffer.alloc(0))).toBe(false);
    expect(tail?.subarray(0, 160).every((byte) => byte === 0)).toBe(false);
    expect(tail?.subarray(160).every((byte) => byte === 0)).toBe(true);
    expect(after && isSilence(after)).toBe(true);
  });

  it("clear corta a fala na hora, e o que vem depois é silêncio", async () => {
    const context = await connect();
    await started(context);
    context.transport.sendAudio(tone(8000, 8000));
    await play(context, 60);
    context.transport.clearAudio();
    await play(context, 200);
    const frames = context.fake.received;
    expect(frames.slice(1, 4).some(isSilence)).toBe(false);
    expect(frames.slice(4).every(isSilence)).toBe(true);
  });

  it("quem ligou desligou: a conversa fica sabendo, e fechar não manda desligar de novo no WaCalls", async () => {
    const context = await connect();
    context.transport.remoteEnded();
    expect(context.hungUp()).toBe(1);
    await context.transport.close();
    expect(context.ends).toEqual([]);
  });

  it("o agente desliga: a fala pendente termina de sair, e só então a ligação é desligada no WaCalls", async () => {
    const context = await connect();
    await started(context);
    context.transport.sendAudio(tone(800, 8000));
    let done = false;
    const hangup = context.transport.hangup().then(() => (done = true));
    await play(context, 100);
    expect(done).toBe(false);
    expect(context.ends).toEqual([]);
    context.time.advance(20);
    await hangup;
    expect(context.ends).toEqual(["DELETE"]);
    expect(context.hungUp()).toBe(0);
    await waitFor(() => context.fake.connection.connectionState === "closed" || context.fake.channel?.readyState === "closed", "the WebRTC leg to close");
  });

  it("a perna WebRTC cai: a conversa fica sabendo, e fechar desliga a ligação no WaCalls, que senão seguraria 30 s", async () => {
    const context = await connect();
    await context.fake.connection.close();
    await waitFor(() => context.hungUp() === 1, "the hangup");
    await context.transport.close();
    expect(context.ends).toEqual(["DELETE"]);
    expect(context.transport.canTransfer).toBe(false);
  });
});
