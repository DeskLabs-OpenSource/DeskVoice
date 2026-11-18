import { handle } from "../../../../../../server/context";
import { optionList, readMenu, replaceOptions } from "../../store";

// Troca as teclas inteiras numa transação, e recusa o conjunto sem nenhuma tecla para uma pessoa.
export const PUT = handle({ body: optionList, configure: true }, async ({ q, params, body, deps }) => {
  const menu = await readMenu(q, params.id ?? "");
  await replaceOptions(q, menu.id, body);
  await q.exec("update ivr_menus set updated_at = $2 where id = $1", [menu.id, deps.clock.now()]);
  return readMenu(q, menu.id);
});
