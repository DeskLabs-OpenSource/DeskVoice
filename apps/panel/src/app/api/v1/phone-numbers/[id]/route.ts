import { personExitOf, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle, notFound } from "../../../../../server/context";
import { phone } from "../../../../../server/shapes";
import { refusingDuplicates } from "../store";

const body = z.object({
  agentId: z.uuid().nullable().optional(),
  number: phone.optional(),
  // `ai`: atende o agente do número, como sempre. `ivr`: atende o menu por teclas `ivrMenuId`.
  mode: z.enum(["ai", "ivr"]).optional(),
  ivrMenuId: z.uuid().nullable().optional(),
});

/**
 * O número só vai para o menu por teclas com um menu que toca alguma coisa e que leva a uma pessoa:
 * sem anúncio, quem liga ouviria silêncio; sem tecla `transfer`, não teria saída. A trava na linha
 * do menu segura a conferência até o fim da transação.
 */
async function requireReadyMenu(q: OrgQuery, menuId: string | null): Promise<void> {
  if (!menuId) throw new ApiError(400, "ivr_menu_required", "Choose the keypad menu that answers this number.");
  const menu = await q.one<{ hasPrompt: boolean }>(`select prompt_audio is not null as "hasPrompt" from ivr_menus where id = $1 for share`, [menuId]);
  if (!menu) throw notFound();
  if (!menu.hasPrompt) throw new ApiError(400, "ivr_menu_no_prompt", "The keypad menu has no announcement yet.");
  const options = await q.many<{ digit: string; action: string }>("select digit, action from ivr_options where menu_id = $1", [menuId]);
  if (!personExitOf(options)) throw new ApiError(400, "ivr_no_person_exit", "The keypad menu needs at least one key that transfers to a person.");
}

// Troca quem atende (o agente, ou o menu por teclas) e corrige o número digitado errado. Campo
// ausente fica como está. Voltar para `ai` solta o menu: ele deixa de estar em uso por este número.
export const PATCH = handle({ body, configure: true }, async ({ q, params, body }) => {
  const current = await q.one<{ e164: string; agentId: string | null; mode: "ai" | "ivr"; ivrMenuId: string | null }>(
    `select e164, agent_id as "agentId", mode, ivr_menu_id as "ivrMenuId" from phone_numbers where id = $1`,
    [params.id],
  );
  if (!current) throw notFound();
  const mode = body.mode ?? current.mode;
  const ivrMenuId = mode === "ai" ? null : body.ivrMenuId === undefined ? current.ivrMenuId : body.ivrMenuId;
  if (mode === "ivr" && (mode !== current.mode || ivrMenuId !== current.ivrMenuId)) await requireReadyMenu(q, ivrMenuId);
  return refusingDuplicates(() =>
    q.one(
      `update phone_numbers set e164 = $2, agent_id = $3, mode = $4, ivr_menu_id = $5 where id = $1
       returning id, e164, trunk_id as "trunkId", agent_id as "agentId", mode, ivr_menu_id as "ivrMenuId"`,
      [params.id, body.number ?? current.e164, body.agentId === undefined ? current.agentId : body.agentId, mode, ivrMenuId],
    ),
  );
});

export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  if ((await q.exec("delete from phone_numbers where id = $1", [params.id])) === 0) throw notFound();
  return null;
});
