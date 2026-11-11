import { handle, notFound } from "../../../../../../server/context";

export const POST = handle({}, async ({ q, params, deps }) => {
  const updated = await q.exec("update notifications set read_at = coalesce(read_at, $2) where id = $1 and channel = 'panel'", [params.id, deps.clock.now()]);
  if (updated === 0) throw notFound();
  return null;
});
