import { eraseCaller, recordOrgEvent, toE164 } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle } from "../../../../../server/context";

const body = z.object({
  phone: z.string().trim().min(3).max(32),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Atende o pedido de apagamento de UM titular: apaga a gravação, troca as falas pelo marcador, zera
 * o resumo e a citação do desfecho e anonimiza o telefone dele nas chamadas encontradas. O registro
 * do serviço (horário, duração, custo, desfecho) fica. Devolve as contagens e grava o recibo em
 * `organization_events`, com quem pediu e quando.
 */
export const POST = handle({ body, configure: true }, async ({ q, body, session, deps }) => {
  const now = deps.clock.now();
  const phone = toE164(body.phone);
  if (!phone) throw new ApiError(400, "invalid_phone", "Telefone inválido.");

  const counts = await eraseCaller(q, {
    dir: deps.recordingsDir,
    organizationId: q.organizationId,
    phoneE164: phone,
    now,
  });
  await recordOrgEvent(q, "caller_data_erased", { ...counts, reason: body.reason ?? null }, now, session.userId);
  return counts;
});
