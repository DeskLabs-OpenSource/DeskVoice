import { handle } from "../../../../../server/context";
import { connectCalls, readCallsStored, type CallsStored } from "../../../../../server/whatsapp-calls";

export const POST = handle(
  { support: false, configure: true, after: (stored: CallsStored, { deps, org, session }) => connectCalls(deps, org, session, stored) },
  ({ q, deps }) => readCallsStored(q, deps.clock.now()),
);
