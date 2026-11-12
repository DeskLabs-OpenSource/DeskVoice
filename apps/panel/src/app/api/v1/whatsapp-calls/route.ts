import { handle } from "../../../../server/context";
import { observeCalls } from "../../../../server/whatsapp-calls";

// Só `owner` e `admin`: a resposta traz o QR Code, e quem o lê vincula um aparelho ao número.
export const GET = handle({ configure: true, after: (_, { deps, org, session }) => observeCalls(deps, org, session.organizationId) }, async () => null);
