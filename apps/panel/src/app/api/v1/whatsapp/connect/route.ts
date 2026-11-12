import { z } from "zod";
import { handle } from "../../../../../server/context";
import { connect, readStored, type Stored } from "../../../../../server/whatsapp";

// `replace` é a confirmação de quem já tinha outro conector: sem ela, nada é substituído.
export const POST = handle(
  { body: z.object({ replace: z.boolean().default(false) }), configure: true, after: (stored: Stored, { deps, org, session, body }) => connect(deps, org, session, stored, body.replace) },
  ({ q, deps }) => readStored(q, deps.clock.now()),
);
