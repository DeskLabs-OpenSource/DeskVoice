import { handle } from "../../../../server/context";
import { ANALYST_COLUMNS, analystCreate, saveAnalyst } from "./store";

export const GET = handle({}, ({ q }) => q.many(`select ${ANALYST_COLUMNS} from analysts order by created_at, id`));

export const POST = handle({ body: analystCreate, configure: true }, ({ q, body, session, deps }) => saveAnalyst(q, session, deps.clock.now(), body, null));
