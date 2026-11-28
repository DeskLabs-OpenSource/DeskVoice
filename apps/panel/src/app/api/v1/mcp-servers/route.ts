import { handle } from "../../../../server/context";
import { listServers } from "../../../../server/mcp-servers";

/** Os servidores MCP da organização. Do segredo, só `{ configured }`. Só para quem administra. */
export const GET = handle({ configure: true }, ({ q, deps }) => listServers(q, deps));
