import { callsOfCaller, countCallerData, countRecordings, toE164 } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle } from "../../../../../../server/context";

const body = z.object({ phone: z.string().trim().min(3).max(32) });

/**
 * Mostra o que um pedido de apagamento alcançaria, sem apagar nada. Apagar é irreversível: quem
 * confirma precisa ver antes quantas chamadas, quantos trechos de fala, quantas gravações e
 * quantas pendências sairiam.
 */
export const POST = handle({ body, configure: true }, async ({ q, body, deps }) => {
  const phone = toE164(body.phone);
  if (!phone) throw new ApiError(400, "invalid_phone", "Telefone inválido.");

  const counts = await countCallerData(q, phone);
  const ids = (await callsOfCaller(q, phone)).map((call) => call.id);
  return { phone, ...counts, recordings: await countRecordings(deps.recordingsDir, q.organizationId, ids) };
});
