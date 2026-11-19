import { handle } from "../../../../server/context";
import { MENU_COLUMNS, menuSettings, optionList, optionsOf, readMenu, replaceOptions, type MenuRow } from "./store";

// A lista dos menus, com as teclas e a duração do anúncio. O áudio nunca vem aqui: só pelo `audio`.
export const GET = handle({}, async ({ q }) => {
  const menus = await q.many<MenuRow>(`select ${MENU_COLUMNS} from ivr_menus order by name, created_at`);
  const options = await optionsOf(
    q,
    menus.map((menu) => menu.id),
  );
  return menus.map((menu) => ({ ...menu, options: options.get(menu.id) ?? [] }));
});

const body = menuSettings.extend({ options: optionList });

// O menu nasce com as teclas, na mesma transação: não existe menu salvo sem uma tecla para uma pessoa.
export const POST = handle({ body, configure: true }, async ({ q, body, deps }) => {
  const now = deps.clock.now();
  const created = await q.one<{ id: string }>(
    "insert into ivr_menus (organization_id, name, language, timeout_ms, max_attempts, on_no_choice, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $7) returning id",
    [q.organizationId, body.name, body.language, body.timeoutMs, body.maxAttempts, body.onNoChoice, now],
  );
  if (!created) throw new Error("ivr menu was not created");
  await replaceOptions(q, created.id, body.options);
  return readMenu(q, created.id);
});
