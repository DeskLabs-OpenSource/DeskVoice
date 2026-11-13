import { z } from "zod";
import { handle, notFound } from "../../../../../../../server/context";
import { voiceRequest } from "../../../../../../../server/voice";

const stopped = z.object({ recording: z.enum(["stopped", "already_stopped", "not_recording"]) });

/**
 * Pedido, feito no painel, para parar a gravação de uma chamada em andamento, porque a pessoa na
 * linha pediu. Quem aplica é o processo de voz, dono da chamada, pela API interna, e a resposta diz
 * o que de fato aconteceu: parou agora, já tinha parado, ou a chamada não estava sendo gravada.
 * O trecho já dito, inclusive o pedido, fica gravado.
 */
export const POST = handle(
  {
    body: z.object({ reason: z.string().trim().max(300).nullish() }),
    after: (callId: string, { deps, session, body }) =>
      voiceRequest(deps, "POST", "/calls/recording/stop", stopped, {
        organizationId: session.organizationId,
        callId,
        userId: session.userId,
        reason: body.reason || null,
      }),
  },
  async ({ q, params }) => {
    // `withOrg` só enxerga a organização da sessão: chamada de outra empresa é chamada que não existe.
    const call = await q.one<{ id: string }>("select id from calls where id = $1 and ended_at is null", [params.id]);
    if (!call) throw notFound();
    return call.id;
  },
);
