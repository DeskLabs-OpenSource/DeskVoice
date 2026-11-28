import { handle } from "../../../../../server/context";
import { checkCrm } from "../../../../../server/whatsapp";

// Só `owner` e `admin`: a conferência usa o token gravado do conector. Ela só lê, nas duas portas do CRM.
export const POST = handle({ configure: true, after: (_, { deps, session }) => checkCrm(deps, session) }, async () => null);
