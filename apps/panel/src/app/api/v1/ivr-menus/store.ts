import { IVR_ACTIONS, IVR_ATTEMPTS, IVR_DIGITS, IVR_LABEL_MAX, IVR_NAME_MAX, IVR_NO_CHOICE_ACTIONS, IVR_TIMEOUT_MS, inKeyOrder, personExitOf, SPOKEN_LANGUAGES, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, notFound } from "../../../../server/context";
import { phone } from "../../../../server/shapes";

/**
 * O menu por teclas (URA, #223) no painel. O banco já recusa o estado ruim que cabe numa linha (os
 * `check`s e as chaves da migration); aqui fica o que olha outras linhas: o menu sem nenhuma tecla
 * que leve a uma pessoa, o número em `ivr` com um menu sem anúncio, e o menu ou o agente que ainda
 * está em uso. A lista nunca devolve o áudio: só a duração.
 */
export const MENU_COLUMNS = `id, name, language, timeout_ms as "timeoutMs", max_attempts as "maxAttempts", on_no_choice as "onNoChoice",
  prompt_audio_ms as "promptAudioMs", created_at as "createdAt", updated_at as "updatedAt"`;

export interface MenuRow {
  id: string;
  name: string;
  language: string;
  timeoutMs: number;
  maxAttempts: number;
  onNoChoice: string;
  promptAudioMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OptionRow {
  digit: string;
  label: string;
  action: string;
  agentId: string | null;
  transferTo: string | null;
}

const name = z.string().trim().min(1).max(IVR_NAME_MAX);

export const menuSettings = z.object({
  name,
  language: z.enum(SPOKEN_LANGUAGES).default("pt-BR"),
  timeoutMs: z.number().int().min(IVR_TIMEOUT_MS.min).max(IVR_TIMEOUT_MS.max).default(IVR_TIMEOUT_MS.default),
  maxAttempts: z.number().int().min(IVR_ATTEMPTS.min).max(IVR_ATTEMPTS.max).default(IVR_ATTEMPTS.default),
  onNoChoice: z.enum(IVR_NO_CHOICE_ACTIONS).default("person"),
});

/** As teclas: cada uma uma vez, e o campo da ação presente só quando a ação o usa. */
export const optionList = z
  .array(
    z
      .object({
        digit: z.string().refine((value) => value.length === 1 && IVR_DIGITS.includes(value), { message: "the key must be one of 0-9, * or #" }),
        label: z.string().trim().min(1).max(IVR_LABEL_MAX),
        action: z.enum(IVR_ACTIONS),
        agentId: z.uuid().nullable().optional(),
        transferTo: phone.nullable().optional(),
      })
      .transform((option, ctx) => {
        const agentId = option.action === "agent" ? (option.agentId ?? null) : null;
        const transferTo = option.action === "transfer" ? (option.transferTo ?? null) : null;
        if (option.action === "agent" && !agentId) ctx.addIssue({ code: "custom", message: `key ${option.digit}: choose the agent` });
        if (option.action === "transfer" && !transferTo) ctx.addIssue({ code: "custom", message: `key ${option.digit}: type the number to transfer to` });
        return { digit: option.digit, label: option.label, action: option.action, agentId, transferTo };
      }),
  )
  .max(IVR_DIGITS.length)
  .refine((options) => new Set(options.map((option) => option.digit)).size === options.length, { message: "each key can be used once" });

export type OptionInput = z.output<typeof optionList>[number];

/** A regra que o `check` não enxerga: sem uma tecla `transfer`, quem liga não tem como chegar a uma pessoa. */
export function requirePersonExit(options: readonly OptionInput[]): void {
  if (!personExitOf(options)) throw new ApiError(400, "ivr_no_person_exit", "The menu needs at least one key that transfers to a person.");
}

/** Troca as opções inteiras, na transação da rota: ou entram todas, ou nenhuma. */
export async function replaceOptions(q: OrgQuery, menuId: string, options: readonly OptionInput[]): Promise<void> {
  requirePersonExit(options);
  await q.exec("delete from ivr_options where organization_id = $1 and menu_id = $2", [q.organizationId, menuId]);
  for (const option of inKeyOrder(options)) {
    await q.exec("insert into ivr_options (organization_id, menu_id, digit, label, action, agent_id, transfer_e164) values ($1, $2, $3, $4, $5, $6, $7)", [
      q.organizationId,
      menuId,
      option.digit,
      option.label,
      option.action,
      option.agentId,
      option.transferTo,
    ]);
  }
}

export async function optionsOf(q: OrgQuery, menuIds: readonly string[]): Promise<Map<string, OptionRow[]>> {
  const rows = await q.many<OptionRow & { menuId: string }>(
    `select menu_id as "menuId", digit, label, action, agent_id as "agentId", transfer_e164 as "transferTo" from ivr_options where menu_id = any($1::uuid[])`,
    [menuIds],
  );
  const byMenu = new Map<string, OptionRow[]>(menuIds.map((id) => [id, []]));
  for (const { menuId, ...option } of rows) byMenu.get(menuId)?.push(option);
  for (const [id, options] of byMenu) byMenu.set(id, inKeyOrder(options));
  return byMenu;
}

/** O menu como a tela o lê: as configurações, as teclas e a duração do anúncio, nunca o áudio. */
export async function readMenu(q: OrgQuery, id: string): Promise<MenuRow & { options: OptionRow[] }> {
  const menu = await q.one<MenuRow>(`select ${MENU_COLUMNS} from ivr_menus where id = $1`, [id]);
  if (!menu) throw notFound();
  return { ...menu, options: (await optionsOf(q, [id])).get(id) ?? [] };
}

/** Os números que atendem pelo menu: apagar o menu os deixaria sem nada para tocar. */
export async function numbersUsing(q: OrgQuery, menuId: string): Promise<string[]> {
  const rows = await q.many<{ e164: string }>("select e164 from phone_numbers where ivr_menu_id = $1 order by e164", [menuId]);
  return rows.map((row) => row.e164);
}

/** Recusa de quem o banco também barraria (`on delete restrict`), mas com o nome de quem está em uso. */
export const menuInUse = (numbers: readonly string[]): ApiError =>
  new ApiError(409, "ivr_menu_in_use", numbers.join(", "));

