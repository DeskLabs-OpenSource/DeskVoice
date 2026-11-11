import { handle } from "../../../../server/context";
import { AGENT_COLUMNS, AGENT_DEFAULTS, agentCreate } from "../../../../server/shapes";
import { insertAgent } from "./store";

export const GET = handle({}, ({ q }) => q.many(`select ${AGENT_COLUMNS} from agents order by created_at`));

export const POST = handle({ body: agentCreate, configure: true }, ({ q, body }) => insertAgent(q, { ...AGENT_DEFAULTS, ...body }));
