import { z } from "zod";
import { handle } from "../../../../../server/context";
import { requireAgent } from "../../../../../server/shapes";
import { callIdSchema, voiceRequest } from "../../../../../server/voice";

export const POST = handle(
  {
    body: z.object({ agentId: z.uuid() }),
    after: (_agent, { deps, session, body }) =>
      voiceRequest(deps, "POST", "/calls/simulate", callIdSchema, { organizationId: session.organizationId, agentId: body.agentId }),
  },
  ({ q, body }) => requireAgent(q, body.agentId),
);
