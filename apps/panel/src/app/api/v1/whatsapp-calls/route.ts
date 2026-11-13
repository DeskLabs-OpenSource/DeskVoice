import { z } from "zod";
import { handle } from "../../../../server/context";
import { chooseCallsAgent, observeCalls } from "../../../../server/whatsapp-calls";

// Só `owner` e `admin`: a resposta traz o QR Code, e quem o lê vincula um aparelho ao número.
export const GET = handle({ configure: true, after: (_, { deps, org, session }) => observeCalls(deps, org, session.organizationId) }, async () => null);

// Escolhe o agente que atende as ligações pelo WhatsApp (nulo: ninguém, e elas seguem tocando no celular).
export const PATCH = handle(
  { body: z.object({ agentId: z.uuid().nullable() }), configure: true, after: (_: void, { deps, org, session }) => observeCalls(deps, org, session.organizationId) },
  ({ q, deps, session, body }) => chooseCallsAgent(q, session, body.agentId, deps.clock.now()),
);
