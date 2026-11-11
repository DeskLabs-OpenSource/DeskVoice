import { handle } from "../../../../server/context";
import { listTools } from "../../../../server/pieces";

export const GET = handle({}, () => listTools());
