import { recordEvent, toE164, withOrg, type Clock, type Db } from "@deskvoice/core";
import { dialString, type AriClient } from "./ari";
import type { AsteriskCalls } from "./asterisk-transport";
import { messageOf, type Logger } from "./log";
import { checkOutboundAllowed } from "./outbound-policy";

export interface OutboundDeps {
  db: Db;
  ari: AriClient;
  clock: Clock;
  calls: AsteriskCalls;
  log: Logger;
}

export type OutboundResult = { callId: string } | { code: string; message: string };

/**
 * Origina uma ligação do agente para `toE164`. Só depois de `checkOutboundAllowed`: não existe
 * outro caminho que origine chamada. A recusa da política também fica gravada, como chamada
 * `refused` com o evento `call_refused`, para quem audita ver o que foi tentado.
 */
export async function startOutboundCall(deps: OutboundDeps, input: { organizationId: string; agentId: string; toE164: string }): Promise<OutboundResult> {
  const { db, ari, clock, log } = deps;
  const to = toE164(input.toE164);
  if (!to) return { code: "invalid_number", message: "The destination is not a valid phone number." };

  type Line = { id: string; caller_id_e164: string | null };
  const prepared = await withOrg(db, input.organizationId, async (q): Promise<{ callId: string; trunk: Line } | { code: string; message: string }> => {
    const agent = await q.one<{ enabled: boolean }>("select enabled from agents where id = $1", [input.agentId]);
    if (!agent) return { code: "agent_not_found", message: "This agent does not exist in this organization." };
    if (!agent.enabled) return { code: "agent_disabled", message: "This agent is turned off." };
    // A linha de saída é a do número do agente; sem número, a única linha da organização.
    const trunks = await q.many<Line>(
      `select t.id, t.caller_id_e164 from trunks t
        where exists (select 1 from phone_numbers p where p.trunk_id = t.id and p.agent_id = $1)
           or not exists (select 1 from phone_numbers p where p.agent_id = $1)
        order by t.id limit 2`,
      [input.agentId],
    );
    const trunk = trunks.length === 1 ? trunks[0] : undefined;
    if (!trunk) return { code: "no_line", message: "There is no single phone line for this agent to call from. Give the agent a number in the phone line settings." };

    const decision = await checkOutboundAllowed(q, to, clock, trunk.caller_id_e164);
    const call = await q.one<{ id: string }>(
      `insert into calls (organization_id, agent_id, direction, from_e164, to_e164, status, end_reason, started_at, ended_at)
       values ($1, $2, 'outbound', $3, $4, $5, $6, $7, $8) returning id`,
      [input.organizationId, input.agentId, trunk.caller_id_e164, to, decision.allowed ? "ringing" : "refused", decision.allowed ? null : decision.code, clock.now(), decision.allowed ? null : clock.now()],
    );
    if (!call) throw new Error("Outbound call was not created");
    if (!decision.allowed) {
      await recordEvent(q, call.id, "call_refused", { reason: decision.code, message: decision.message, to }, clock.now());
      return { code: decision.code, message: decision.message };
    }
    return { callId: call.id, trunk };
  });
  if (!("callId" in prepared)) return prepared;

  const { callId, trunk } = prepared;
  // O id do canal é o da chamada, escolhido antes de originar: quando o AudioSocket conectar, a
  // chamada já é esperada.
  deps.calls.expect({ callId, channelId: callId, organizationId: input.organizationId, agentId: input.agentId, trunkId: trunk.id });
  try {
    await ari.originate({
      endpoint: dialString(to, trunk.id),
      context: "deskvoice-audio",
      extension: "s",
      channelId: callId,
      callerId: trunk.caller_id_e164 ?? undefined,
      variables: { AUDIOSOCKET_UUID: callId },
    });
  } catch (error) {
    log("error", "could not originate the outbound call", { callId, error: messageOf(error) });
    // Fecha a chamada como falha (o canal não chegou a existir).
    await deps.calls.channelDestroyed(callId, messageOf(error));
    return { code: "originate_failed", message: `The telephony server could not place the call: ${messageOf(error)}` };
  }
  return { callId };
}
