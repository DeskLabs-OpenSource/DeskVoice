import { handle } from "../../../../server/context";
import { observe } from "../../../../server/whatsapp";

// Só `owner` e `admin`: a resposta traz o QR Code, e quem o lê passa a enviar pelo número.
export const GET = handle({ configure: true, after: (_, { deps, org, session }) => observe(deps, org, session.organizationId) }, async () => null);
