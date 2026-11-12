import { z } from "zod";
import { handle } from "../../../../../server/context";
import { changeService } from "../../../../../server/whatsapp";

// Instalar ou remover o serviço de WhatsApp do servidor. O painel só grava o pedido; quem executa
// é o agente do kit, que lê disto um sim ou um não e mais nada.
export const POST = handle(
  { body: z.object({ wanted: z.boolean() }), configure: true, after: (_: void, { deps, org, session, body }) => changeService(deps, org, session, body.wanted) },
  async () => undefined,
);
