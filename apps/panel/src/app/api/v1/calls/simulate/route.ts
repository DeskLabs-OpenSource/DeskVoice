import { z } from "zod";
import { handle } from "../../../../../server/context";
import { phone, requireAgent } from "../../../../../server/shapes";
import { callIdSchema, voiceRequest } from "../../../../../server/voice";

export const POST = handle(
  {
    // `from`: o número de quem "liga" na simulada, opcional. Com ele, a simulada entra na memória do
    // número como uma recebida, e a segunda simulada do mesmo número mostra a primeira.
    body: z.object({ agentId: z.uuid(), from: phone.optional() }),
    after: (_agent, { deps, session, body }) =>
      voiceRequest(deps, "POST", "/calls/simulate", callIdSchema, { organizationId: session.organizationId, agentId: body.agentId, ...(body.from && { fromE164: body.from }) }),
  },
  ({ q, body }) => requireAgent(q, body.agentId),
);
