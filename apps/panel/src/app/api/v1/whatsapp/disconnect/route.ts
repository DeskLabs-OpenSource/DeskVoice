import { handle } from "../../../../../server/context";
import { disconnect } from "../../../../../server/whatsapp";

export const POST = handle({ configure: true, after: (_, { deps, org, session }) => disconnect(deps, org, session) }, async () => null);
