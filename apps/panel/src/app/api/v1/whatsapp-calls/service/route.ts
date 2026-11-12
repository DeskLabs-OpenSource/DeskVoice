import { z } from "zod";
import { handle } from "../../../../../server/context";
import { changeCallsService } from "../../../../../server/whatsapp-calls";

// Instalar ou remover o serviço de ligação pelo WhatsApp. O painel só grava o pedido; quem executa
// é o agente do kit, que lê disto um sim ou um não e mais nada.
export const POST = handle(
  { body: z.object({ wanted: z.boolean() }), configure: true, after: (_: void, { deps, org, session, body }) => changeCallsService(deps, org, session, body.wanted) },
  async () => undefined,
);
