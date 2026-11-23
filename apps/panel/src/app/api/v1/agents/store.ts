import type { OrgQuery } from "@deskvoice/core";
import { requireBelowLimit } from "../../../../server/limits";
import { AGENT_COLUMNS, type AgentValues } from "../../../../server/shapes";

const values = (agent: AgentValues): unknown[] => [
  agent.name,
  agent.roleLabel,
  agent.instructions,
  agent.greeting,
  agent.engine,
  agent.voiceId,
  agent.language,
  agent.tools,
  agent.enabled,
  agent.maxCallSeconds,
  agent.costCeilingCents,
  agent.transferTo,
  agent.followUpOwnerUserId,
  agent.vocabulary,
  agent.listeningEnvironment,
  agent.agentHandoffTargets,
  agent.dropFollowUp,
  agent.dropFollowUpMessage,
  agent.analystId,
  agent.analysisBrain === null ? null : JSON.stringify(agent.analysisBrain),
  agent.transferReturnsToAgent,
  agent.callerIdleGuard,
];

/** Todo agente novo entra por aqui, e daqui nunca sem conferir o limite da organização (seção 3.4 do R8). */
export async function insertAgent(q: OrgQuery, agent: AgentValues) {
  await requireBelowLimit(q, "agents");
  return q.one(
    `insert into agents (organization_id, name, role_label, instructions, greeting, engine, voice_id, language, tools, enabled,
                         max_call_seconds, cost_ceiling_cents, transfer_to_e164, follow_up_owner_user_id, vocabulary,
                         listening_environment, agent_handoff_targets, drop_follow_up, drop_follow_up_message, analyst_id, analysis_brain,
                         transfer_returns_to_agent, caller_idle_guard)
     values ($23, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21, $22) returning ${AGENT_COLUMNS}`,
    [...values(agent), q.organizationId],
  );
}

/**
 * `analysisBrainGiven` falso deixa `analysis_brain` como está no banco: salvar outro campo não regrava
 * a escolha, nem a fora da forma (o `null` do JSON gravado à mão voltaria como nulo da coluna, que é
 * "segue a organização", e a rotina passaria a ler pela organização).
 */
export function updateAgent(q: OrgQuery, id: string, agent: AgentValues, now: Date, analysisBrainGiven: boolean) {
  return q.one(
    `update agents set name = $1, role_label = $2, instructions = $3, greeting = $4, engine = $5, voice_id = $6, language = $7,
            tools = $8, enabled = $9, max_call_seconds = $10, cost_ceiling_cents = $11, transfer_to_e164 = $12,
            follow_up_owner_user_id = $13, vocabulary = $14, listening_environment = $15, agent_handoff_targets = $16,
            drop_follow_up = $17, drop_follow_up_message = $18, analyst_id = $19, analysis_brain = case when $25::boolean then $20::jsonb else analysis_brain end,
            transfer_returns_to_agent = $21, caller_idle_guard = $22, updated_at = $24
      where id = $23 returning ${AGENT_COLUMNS}`,
    [...values(agent), id, now, analysisBrainGiven],
  );
}
