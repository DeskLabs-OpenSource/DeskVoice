import { z } from "zod";
import { handle } from "../../../../../server/context";
import { requireAgent } from "../../../../../server/shapes";
import { VOICE_SOCKET_PATH, voiceRequest, webCallSchema } from "../../../../../server/voice";

// Chamada pelo navegador: o painel só pede o convite. Quem confere se o agente pode atender
// (ligado, motor com chave, motor que conversa) é o processo de voz, e a recusa dele segue para
// a tela com o código próprio. O convite vale para a organização e o usuário da sessão.
export const POST = handle(
  {
    body: z.object({ agentId: z.uuid() }),
    after: async (_agent, { deps, session, body }) => {
      const call = await voiceRequest(deps, "POST", "/calls/web", webCallSchema, { organizationId: session.organizationId, agentId: body.agentId, userId: session.userId });
      return { callId: call.callId, token: call.token, ws: { path: VOICE_SOCKET_PATH } };
    },
  },
  ({ q, body }) => requireAgent(q, body.agentId),
);
