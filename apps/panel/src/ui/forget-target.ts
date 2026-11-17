import { toE164 } from "@deskvoice/core/phone";

/**
 * O número que "Esquecer este número" vai esquecer, já como o servidor o lê (a mesma `toE164` da
 * rota). A confirmação nomeia este, e não o texto digitado; `null` é número inválido, e a tela recusa
 * antes de abrir a confirmação. Vem de `@deskvoice/core/phone`, e não da raiz do pacote, que leva
 * `pg` e não entra no navegador.
 */
export function forgetTarget(typed: string): string | null {
  return toE164(typed);
}
