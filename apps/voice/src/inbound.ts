import { recordEvent, resolveInboundRoute, toE164, withOrg, type Clock, type Db } from "@deskvoice/core";
import type { AriChannel, AriClient } from "./ari";
import type { AsteriskCalls } from "./asterisk-transport";
import { messageOf, type Logger } from "./log";
import { panelNotice } from "./panel-notice";

export interface InboundDeps {
  db: Db;
  ari: AriClient;
  clock: Clock;
  calls: AsteriskCalls;
  log: Logger;
}

// O canal chega como `PJSIP/trunk-<uuid do tronco>-<sufixo>`: `trunks.ts` cria o endpoint com esse nome.
const TRUNK_CHANNEL = /^PJSIP\/trunk-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i;

const NOTICE: Record<"no_agent" | "agent_disabled", (dialed: string) => string> = {
  no_agent: (dialed) => `Uma ligação para ${dialed} foi recusada porque nenhum agente atende esse número. Escolha o agente do número em Linha telefônica.`,
  agent_disabled: (dialed) => `Uma ligação para ${dialed} foi recusada porque o agente desse número está desligado. Ligue o agente ou escolha outro em Linha telefônica.`,
};

/**
 * Chamada recebida (`StasisStart` com o argumento `inbound`). Quem define a organização é o tronco
 * por onde ela chegou; o número discado só é procurado dentro dela. Com agente, cria a chamada e
 * manda o canal para o AudioSocket. Sem, recusa: desliga e, se a organização é conhecida, deixa a
 * chamada recusada e um aviso no painel.
 */
export async function handleInbound(deps: InboundDeps, channel: AriChannel): Promise<void> {
  const { db, ari, clock, log } = deps;
  const trunkId = TRUNK_CHANNEL.exec(channel.name ?? "")?.[1]?.toLowerCase();
  const exten = channel.dialplan?.exten ?? "s";
  // Tronco de um número só manda o literal "s" no lugar dos dígitos; o que não dá para ler como
  // telefone é tratado do mesmo jeito, e a rota só sai se o tronco tiver um único número.
  const dialed = exten === "s" ? null : toE164(exten);
  const from = channel.caller?.number ? toE164(channel.caller.number) : null;

  const route = trunkId ? await resolveInboundRoute(db, trunkId, dialed) : null;
  if (!route) {
    log("error", "inbound call from a channel that is not a known trunk; refusing", { channel: channel.name, exten });
    await ari.hangup(channel.id);
    return;
  }

  const outcome = await withOrg(db, route.organizationId, async (q) => {
    const number = route.phoneNumberId ? await q.one<{ e164: string }>("select e164 from phone_numbers where id = $1", [route.phoneNumberId]) : null;
    const agent = route.agentId ? await q.one<{ enabled: boolean }>("select enabled from agents where id = $1", [route.agentId]) : null;
    const to = number?.e164 ?? dialed;
    const refusal = !agent ? "no_agent" : !agent.enabled ? "agent_disabled" : null;
    const call = await q.one<{ id: string }>(
      `insert into calls (organization_id, agent_id, direction, from_e164, to_e164, status, end_reason, started_at, ended_at)
       values ($1, $2, 'inbound', $3, $4, $5, $6, $7, $8) returning id`,
      [route.organizationId, route.agentId, from, to, refusal ? "refused" : "ringing", refusal, clock.now(), refusal ? clock.now() : null],
    );
    if (!call) throw new Error("Inbound call was not created");
    if (refusal) {
      await recordEvent(q, call.id, "call_refused", { reason: refusal, from, to, dialed: exten }, clock.now());
      await panelNotice(q, clock, call.id, NOTICE[refusal](to ?? "um número que este tronco não informou"));
    }
    return { callId: call.id, refusal };
  });

  if (outcome.refusal || !route.agentId) {
    log("info", "inbound call refused", { callId: outcome.callId, reason: outcome.refusal });
    await ari.hangup(channel.id);
    return;
  }

  deps.calls.expect({ callId: outcome.callId, channelId: channel.id, organizationId: route.organizationId, agentId: route.agentId, trunkId: route.trunkId });
  try {
    // O dialplan abre o AudioSocket com este UUID: é ele que liga a conexão de áudio à chamada.
    await ari.setVariable(channel.id, "AUDIOSOCKET_UUID", outcome.callId);
    await ari.continueDialplan(channel.id, "deskvoice-audio", "s");
  } catch (error) {
    log("error", "could not send the inbound channel to the audio context", { callId: outcome.callId, error: messageOf(error) });
    // O canal some sem áudio: `channelDestroyed` fecha a chamada como falha.
    await ari.hangup(channel.id);
  }
}
