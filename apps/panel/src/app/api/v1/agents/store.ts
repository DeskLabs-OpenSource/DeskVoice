import type { OrgQuery } from "@deskvoice/core";
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
];

export function insertAgent(q: OrgQuery, agent: AgentValues) {
  return q.one(
    `insert into agents (organization_id, name, role_label, instructions, greeting, engine, voice_id, language, tools, enabled,
                         max_call_seconds, cost_ceiling_cents, transfer_to_e164, follow_up_owner_user_id, vocabulary)
     values ($15, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning ${AGENT_COLUMNS}`,
    [...values(agent), q.organizationId],
  );
}

export function updateAgent(q: OrgQuery, id: string, agent: AgentValues, now: Date) {
  return q.one(
    `update agents set name = $1, role_label = $2, instructions = $3, greeting = $4, engine = $5, voice_id = $6, language = $7,
            tools = $8, enabled = $9, max_call_seconds = $10, cost_ceiling_cents = $11, transfer_to_e164 = $12,
            follow_up_owner_user_id = $13, vocabulary = $14, updated_at = $16
      where id = $15 returning ${AGENT_COLUMNS}`,
    [...values(agent), id, now],
  );
}
