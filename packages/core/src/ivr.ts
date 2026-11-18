import { spokenLanguageOf, type SpokenLanguage } from "./spoken-language";
import type { OrgQuery } from "./types";

/**
 * O menu por teclas (URA), fatia 1 (#223): um nível, um anúncio, e o que cada tecla faz.
 *
 * Um número em `phone_numbers.mode = 'ivr'` atende pelo menu em vez de pelo agente. Cada opção leva
 * a um agente de IA, a uma pessoa (transferência para um número E.164) ou desliga. Todo menu tem ao
 * menos uma saída para uma pessoa (`personExitOf`): é regra de aplicação, conferida ao salvar as
 * opções e ao pôr um número em `ivr`, porque um `check` não enxerga outras linhas.
 *
 * A tecla apertada é dado de quem liga (pode ser CPF, cartão, senha): só a tecla de uma opção que
 * existe vira evento, e nunca a sequência digitada.
 */
export const IVR_ACTIONS = ["agent", "transfer", "hangup"] as const;
export type IvrAction = (typeof IVR_ACTIONS)[number];

export const IVR_NO_CHOICE_ACTIONS = ["person", "hangup"] as const;
export type IvrNoChoice = (typeof IVR_NO_CHOICE_ACTIONS)[number];

/** As teclas, na ordem em que aparecem no teclado: "a primeira opção" é a primeira nesta ordem. */
export const IVR_DIGITS = "1234567890*#";

/** O anúncio dura no máximo 60 s: 960 000 bytes de PCM16 a 8 kHz (o `check` da tabela). */
export const IVR_MAX_PROMPT_MS = 60_000;
export const IVR_MAX_PROMPT_BYTES = 960_000;

/** Os limites da tabela (`check`s da migration), para a API e a tela dizerem o mesmo que o banco. */
export const IVR_NAME_MAX = 60;
export const IVR_LABEL_MAX = 60;
export const IVR_TIMEOUT_MS = { min: 2000, max: 15_000, default: 5000 } as const;
export const IVR_ATTEMPTS = { min: 1, max: 5, default: 3 } as const;

export interface IvrOption {
  digit: string;
  label: string;
  action: IvrAction;
  agentId: string | null;
  transferE164: string | null;
}

/** O menu como o processo de voz precisa dele: lido de uma vez, dentro da transação do inbound. */
export interface IvrMenu {
  id: string;
  name: string;
  language: SpokenLanguage;
  /** PCM16 mono a 8 kHz, sem cabeçalho. Nulo enquanto o operador não subiu o anúncio. */
  promptAudio: Buffer | null;
  timeoutMs: number;
  maxAttempts: number;
  onNoChoice: IvrNoChoice;
  /** Na ordem do teclado (`IVR_DIGITS`). */
  options: IvrOption[];
}

const keyOrder = (digit: string): number => {
  const at = IVR_DIGITS.indexOf(digit);
  return at === -1 ? IVR_DIGITS.length : at;
};

/** As opções na ordem do teclado. */
export function inKeyOrder<T extends { digit: string }>(options: readonly T[]): T[] {
  return [...options].sort((a, b) => keyOrder(a.digit) - keyOrder(b.digit));
}

/** A saída para uma pessoa: a primeira opção `transfer`, na ordem do teclado. Sem ela, o menu não serve. */
export function personExitOf<T extends { digit: string; action: string }>(options: readonly T[]): T | undefined {
  return inKeyOrder(options).find((option) => option.action === "transfer");
}

/**
 * Lê o menu e as opções, dentro da organização da transação (a RLS isola). `null` se o menu não
 * existe nela.
 */
export async function loadIvrMenu(q: OrgQuery, menuId: string): Promise<IvrMenu | null> {
  const menu = await q.one<{
    id: string;
    name: string;
    language: string;
    prompt_audio: Buffer | null;
    timeout_ms: number;
    max_attempts: number;
    on_no_choice: IvrNoChoice;
  }>("select id, name, language, prompt_audio, timeout_ms, max_attempts, on_no_choice from ivr_menus where organization_id = $1 and id = $2", [q.organizationId, menuId]);
  if (!menu) return null;
  const options = await q.many<{ digit: string; label: string; action: IvrAction; agent_id: string | null; transfer_e164: string | null }>(
    "select digit, label, action, agent_id, transfer_e164 from ivr_options where organization_id = $1 and menu_id = $2",
    [q.organizationId, menuId],
  );
  return {
    id: menu.id,
    name: menu.name,
    language: spokenLanguageOf(menu.language),
    promptAudio: menu.prompt_audio,
    timeoutMs: menu.timeout_ms,
    maxAttempts: menu.max_attempts,
    onNoChoice: menu.on_no_choice,
    options: inKeyOrder(options.map((row) => ({ digit: row.digit, label: row.label, action: row.action, agentId: row.agent_id, transferE164: row.transfer_e164 }))),
  };
}
