import { countCallerData } from "@deskvoice/core";
import { z } from "zod";
import { handle } from "../../../../../../server/context";
import { phone } from "../../../../../../server/shapes";

/**
 * Mostra o que um pedido de apagamento alcançaria, sem apagar nada. Apagar é irreversível: quem
 * confirma precisa ver antes o tamanho do que sai, e saber se há chamada viva desse número (aí o
 * apagamento espera ela terminar).
 */
export const POST = handle({ body: z.object({ phone }), configure: true }, async ({ q, body, deps }) => ({
  phone: body.phone,
  ...(await countCallerData(q, { dir: deps.recordingsDir, phoneE164: body.phone })),
}));
