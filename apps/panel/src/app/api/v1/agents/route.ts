import { handle } from "../../../../server/context";
import { AGENT_COLUMNS, AGENT_DEFAULTS, agentCreate, requireActiveOwner, requireDropFollowUpMode, requireAnalysisBrain, requireAnalyst, requireHandoffTargets } from "../../../../server/shapes";
import { requirePipeline } from "../../../../server/pipeline";
import { insertAgent } from "./store";

export const GET = handle({}, ({ q }) => q.many(`select ${AGENT_COLUMNS} from agents order by created_at`));

export const POST = handle({ support: false, body: agentCreate, configure: true }, async ({ q, body, deps }) => {
  await requireActiveOwner(q, body.followUpOwnerUserId);
  await requireHandoffTargets(q, null, body.agentHandoffTargets);
  await requireDropFollowUpMode(q, body.dropFollowUp);
  await requireAnalyst(q, body.analystId);
  const { acceptUnmeasured, ...fields } = body;
  await requireAnalysisBrain(q, fields.analysisBrain, acceptUnmeasured);
  await requirePipeline(q, deps, fields.pipeline);
  return insertAgent(q, { ...AGENT_DEFAULTS, ...fields });
});
