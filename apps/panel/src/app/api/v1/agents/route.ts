import { handle } from "../../../../server/context";
import { AGENT_COLUMNS, AGENT_DEFAULTS, agentCreate, requireActiveOwner, requireDropFollowUpMode, requireHandoffTargets } from "../../../../server/shapes";
import { insertAgent } from "./store";

export const GET = handle({}, ({ q }) => q.many(`select ${AGENT_COLUMNS} from agents order by created_at`));

export const POST = handle({ body: agentCreate, configure: true }, async ({ q, body }) => {
  await requireActiveOwner(q, body.followUpOwnerUserId);
  await requireHandoffTargets(q, null, body.agentHandoffTargets);
  await requireDropFollowUpMode(q, body.dropFollowUp);
  return insertAgent(q, { ...AGENT_DEFAULTS, ...body });
});
