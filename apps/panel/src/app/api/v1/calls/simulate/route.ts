import { z } from "zod";
import { handle } from "../../../../../server/context";
import { phone, requireActiveOrganization, requireAgent } from "../../../../../server/shapes";
import { callIdSchema, voiceRequest } from "../../../../../server/voice";

export const POST = handle(
  {
    // `from`: o número de quem "liga" na simulada, opcional. Com ele, a simulada aparece no bloco "Este
    // número" com a marca "Simulada", e os avisos não a contam como ligação.
    body: z.object({ agentId: z.uuid(), from: phone.optional() }),
    after: (_agent, { deps, session, body }) =>
      voiceRequest(deps, "POST", "/calls/simulate", callIdSchema, { organizationId: session.organizationId, agentId: body.agentId, ...(body.from && { fromE164: body.from }) }),
  },
  async ({ q, body }) => {
    await requireActiveOrganization(q);
    await requireAgent(q, body.agentId);
  },
);
