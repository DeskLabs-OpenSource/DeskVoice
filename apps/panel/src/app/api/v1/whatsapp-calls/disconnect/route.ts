import { handle } from "../../../../../server/context";
import { disconnectCalls } from "../../../../../server/whatsapp-calls";

export const POST = handle({ configure: true, after: (_, { deps, org, session }) => disconnectCalls(deps, org, session) }, async () => null);
