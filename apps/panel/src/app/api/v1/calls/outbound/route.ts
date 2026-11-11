import { z } from "zod";
import { handle } from "../../../../../server/context";
import { phone, requireAgent } from "../../../../../server/shapes";
import { callIdSchema, voiceRequest } from "../../../../../server/voice";

const body = z.object({ agentId: z.uuid(), toE164: phone });

// O painel não decide se pode ligar: quem aplica a política de saída é o processo de voz
// (`checkOutboundAllowed`), e a recusa dele chega à tela com o código próprio.
export const POST = handle(
  {
    body,
    configure: true,
    after: (_agent, { deps, session, body }) =>
      voiceRequest(deps, "POST", "/calls/outbound", callIdSchema, { organizationId: session.organizationId, agentId: body.agentId, toE164: body.toE164 }),
  },
  ({ q, body }) => requireAgent(q, body.agentId),
);
