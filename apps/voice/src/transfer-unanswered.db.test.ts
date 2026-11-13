// Transferência que não completa: a chamada para de dizer "transferida" e a equipe recebe o briefing.
import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import type { AudioSocketConnection } from "./audiosocket";
import { AsteriskCalls } from "./asterisk-transport";
import { callOf, createAgent, createCall, createOrganization, createTrunk, eventsOf, fakeAri, fakeClock } from "./testing/db";

const { app, owner } = openTestDbs();

afterAll(async () => {
  await app.close();
  await owner.close();
});

const DESTINO = "+5511988887777";

/** Só o que o transporte usa: o áudio não interessa aqui, o que se prova é o fim da transferência. */
const conexao = (id: string): AudioSocketConnection => ({
  id,
  onAudio: () => undefined,
  onDtmf: () => undefined,
  onClose: () => undefined,
  sendAudio: () => undefined,
  clearAudio: () => undefined,
  sendTone: () => Promise.resolve(),
  drained: async () => undefined,
  close: () => undefined,
});

/** Chamada com o briefing que a ferramenta gravou antes de pedir a transferência. */
const cenario = async (label: string, dialStatus: string) => {
  const org = await createOrganization(app, label);
  const agentId = await createAgent(app, org);
  const trunkId = await createTrunk(app, org);
  const callId = await createCall(app, org, agentId, fakeClock().now());
  await withSystem(app, (q) =>
    q.exec("update calls set status = 'transferred', end_reason = 'transferred', from_e164 = '+5541999998888' where id = $1", [callId]),
  );
  await withSystem(app, (q) =>
    q.exec("insert into call_events (organization_id, call_id, kind, payload, at) values ($1, $2, 'transfer_started', $3, now())", [
      org,
      callId,
      JSON.stringify({ to: DESTINO, reason: "quer falar com o financeiro", summary: "Cliente quer a segunda via do boleto de outubro." }),
    ]),
  );

  const ari = fakeAri();
  const calls = new AsteriskCalls({ ari, db: app, clock: fakeClock(), log: () => undefined });
  const channelId = `channel-${label}`;
  calls.expect({ callId, channelId, organizationId: org, agentId, trunkId });
  // `attach` com o id da chamada, como o AudioSocket entrega; é o que deixa o transporte pedir a
  // transferência (`transferTo`) antes de o dialplan devolver o `DIALSTATUS`.
  await calls.attach(conexao(callId))?.transport.transfer(DESTINO);
  await calls.transferEnded(channelId, dialStatus);

  const avisos = await withSystem(app, (q) =>
    q.many<{ channel: string; body: string }>("select channel, body from notifications where call_id = $1", [callId]),
  );
  return { callId, ari, avisos };
};

describe("transferência que não completa", () => {
  it("ninguém atendeu: o motivo muda e quem opera recebe o briefing para retornar", async () => {
    const { callId, ari, avisos } = await cenario("transfer-noanswer", "NOANSWER");

    expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "transfer_unanswered" });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.channel).toBe("panel");
    const corpo = avisos[0]?.body ?? "";
    expect(corpo).toContain("Ninguém atendeu a transferência");
    expect(corpo).toContain("7777");
    expect(corpo).toContain("8888");
    expect(corpo).toContain("quer falar com o financeiro");
    expect(corpo).toContain("segunda via do boleto");
    expect(corpo).toContain("retorne a ligação");
    expect(ari.log.filter((line) => line.startsWith("hangup"))).toHaveLength(1);
    expect(await eventsOf(app, callId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "transfer_completed", payload: expect.objectContaining({ status: "NOANSWER", answered: false }) }),
      ]),
    );
  });

  it("atendida: nada de aviso e o motivo continua sendo transferência comum", async () => {
    const { callId, avisos } = await cenario("transfer-answer", "ANSWER");

    expect(await callOf(app, callId)).toMatchObject({ end_reason: "transferred" });
    expect(avisos).toEqual([]);
    expect(await eventsOf(app, callId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "transfer_completed", payload: expect.objectContaining({ status: "ANSWER", answered: true }) }),
      ]),
    );
  });

  it("quem ligou desistiu: avisa, mas não inventa falha da equipe", async () => {
    const { callId, avisos } = await cenario("transfer-hangup", "CALLER_HANGUP");

    // O motivo do desligamento é de quem ligou, não da equipe: não é sobrescrito.
    expect(await callOf(app, callId)).toMatchObject({ end_reason: "transferred" });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.body).toContain("desligou antes de a transferência");
  });
});
