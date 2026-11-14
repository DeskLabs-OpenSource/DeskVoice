import { withOrg } from "@deskvoice/core";
import { SIMULATED_PREFIX, type SimulatedScript } from "@deskvoice/voice-engine";
import { startCallSession, type CallSession, type CallSessionDeps } from "./call-session";
import { DEMO_TOOLS, demoScript } from "./demo-script";
import { createSimulatedTransport, type SimulatedTransport } from "./simulated-transport";
import type { Schedule } from "./transport";

export type SimulatedCall = { callId: string; session: CallSession; transport: SimulatedTransport } | { code: string; message: string };

/**
 * Cria uma chamada e roda a conversa inteira sem telefonia: transporte simulado e motor `simulated`
 * seguindo o roteiro de demonstração (ou o roteiro dado). Devolve assim que a chamada existe; a
 * conversa segue em segundo plano (`session.done`).
 */
export async function startSimulatedCall(
  deps: CallSessionDeps,
  input: { organizationId: string; agentId: string },
  options: { script?: SimulatedScript; tools?: string[]; transportSchedule?: Schedule } = {},
): Promise<SimulatedCall> {
  const { organizationId, agentId } = input;
  const created = await withOrg(deps.db, organizationId, async (q) => {
    const agent = await q.one<{ greeting: string | null; transfer_to_e164: string | null }>("select greeting, transfer_to_e164 from agents where id = $1", [agentId]);
    if (!agent) return null;
    const call = await q.one<{ id: string }>(
      "insert into calls (organization_id, agent_id, direction, channel, status, engine, started_at) values ($1, $2, 'inbound', 'simulated', 'ringing', 'simulated', $3) returning id",
      [organizationId, agentId, deps.clock.now()],
    );
    if (!call) throw new Error("Simulated call was not created");
    return { callId: call.id, agent };
  });
  if (!created) return { code: "agent_not_found", message: "This agent does not exist in this organization." };

  const script = options.script ?? demoScript({ greet: !created.agent.greeting, canTransfer: created.agent.transfer_to_e164 !== null });
  const transport = createSimulatedTransport({ schedule: options.transportSchedule });
  const session = startCallSession(deps, {
    organizationId,
    callId: created.callId,
    agentId,
    transport,
    started: { channel: "simulated" },
    overrides: { engineId: "simulated", instructions: SIMULATED_PREFIX + JSON.stringify(script), tools: options.tools ?? DEMO_TOOLS },
  });
  return { callId: created.callId, session, transport };
}
