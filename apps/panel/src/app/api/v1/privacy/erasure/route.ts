import { eraseCaller, recordOrgEvent } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle } from "../../../../../server/context";
import { phone } from "../../../../../server/shapes";

// Sem campo de motivo: o recibo mora em `organization_events`, que só aceita acréscimo, e um texto
// livre digitado ali (que pode trazer o nome ou a fala da pessoa) nunca mais poderia ser apagado.
const body = z.object({ phone }).strict();

/**
 * Atende o pedido de apagamento de UM titular (`eraseCaller`): sai a fala e o texto sobre a pessoa
 * nas chamadas encontradas, e o telefone dela vira nulo; o registro do serviço e a lista de não
 * ligar ficam. Recusa com 409 enquanto houver chamada viva desse número. Grava o recibo em
 * `organization_events` com quem pediu, as contagens e só os quatro últimos dígitos do telefone.
 */
export const POST = handle({ body, configure: true }, async ({ q, body, session, deps }) => {
  const now = deps.clock.now();
  const counts = await eraseCaller(q, { dir: deps.recordingsDir, phoneE164: body.phone, now });
  if (counts === "live_call") throw new ApiError(409, "caller_call_live", "There is a live call with this number. Wait for it to end and try again.");
  await recordOrgEvent(q, "caller_data_erased", { ...counts, phoneSuffix: body.phone.slice(-4) }, now, session.userId);
  return counts;
});
