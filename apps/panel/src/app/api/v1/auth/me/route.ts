import { handle } from "../../../../../server/context";

export const GET = handle({}, async ({ session }) => ({ name: session.name, email: session.email, role: session.role }));
