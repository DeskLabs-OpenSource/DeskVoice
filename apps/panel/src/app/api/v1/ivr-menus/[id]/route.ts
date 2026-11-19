import { handle, notFound } from "../../../../../server/context";
import { menuInUse, menuSettings, numbersUsing, readMenu } from "../store";

export const GET = handle({}, ({ q, params }) => readMenu(q, params.id ?? ""));

const body = menuSettings.partial();

// Nome, idioma, espera, tentativas e o que fazer sem escolha. As teclas vão por `options`, o anúncio por `audio`.
export const PATCH = handle({ body, configure: true }, async ({ q, params, body, deps }) => {
  const current = await readMenu(q, params.id ?? "");
  await q.exec("update ivr_menus set name = $2, language = $3, timeout_ms = $4, max_attempts = $5, on_no_choice = $6, updated_at = $7 where id = $1", [
    current.id,
    body.name ?? current.name,
    body.language ?? current.language,
    body.timeoutMs ?? current.timeoutMs,
    body.maxAttempts ?? current.maxAttempts,
    body.onNoChoice ?? current.onNoChoice,
    deps.clock.now(),
  ]);
  return readMenu(q, current.id);
});

// O menu que atende um número não sai: o erro diz qual número, para trocar o atendimento dele antes.
// A trava na linha do menu vem antes da conferência: quem põe um número nele ao mesmo tempo espera,
// e o `on delete restrict` da chave nunca chega a ser o que responde.
export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  if (!(await q.one("select id from ivr_menus where id = $1 for update", [params.id]))) throw notFound();
  const numbers = await numbersUsing(q, params.id ?? "");
  if (numbers.length > 0) throw menuInUse(numbers);
  await q.exec("delete from ivr_menus where id = $1", [params.id]);
  return null;
});
