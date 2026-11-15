import { z } from "zod";
import { ApiError, handle, notFound } from "../../../../../../../server/context";
import { voiceRequest } from "../../../../../../../server/voice";

const stopped = z.object({ recording: z.enum(["stopped", "already_stopped", "not_recording"]) });

/**
 * Pedido, feito no painel, para parar a gravação de uma chamada em andamento, porque a pessoa na
 * linha pediu. Quem aplica é o processo de voz, dono da chamada, pela API interna, e a resposta diz
 * o que de fato aconteceu: parou agora, já tinha parado, ou a chamada não estava sendo gravada.
 * O trecho já dito, inclusive o pedido, fica gravado.
 *
 * O recado da caixa postal não aceita o pedido: não há pessoa do time na linha para recebê-lo, e quem
 * ligou ouviu o aviso e desiste do recado desligando (decisão 0018). A tela nem oferece o botão.
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
    const call = await q.one<{ id: string; voicemail: boolean }>("select id, voicemail from calls where id = $1 and ended_at is null", [params.id]);
    if (!call) throw notFound();
    if (call.voicemail) throw new ApiError(409, "recording_voicemail", "This call is a voicemail: the caller heard the recording notice and ends the message by hanging up.");
    return call.id;
  },
);
