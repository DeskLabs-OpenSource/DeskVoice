// O teto de custo por ligação, como a tela o lê e o mostra. Zero é "sem teto" na sessão de voz
// (`apps/voice/src/call-session.ts`), e um valor abaixo de meio centavo vira zero no arredondamento.
// A tela diz isso sempre, e avisa em destaque quando o que está digitado vai sem teto (#610, 3.5).
import type { ReactNode } from "react";
import type ptBR from "../../../../i18n/pt-BR/agents";

/** Os centavos que o formulário manda: a mesma conta do salvar, com vírgula ou ponto. */
export function costCeilingCents(text: string): number {
  return Math.round(Number(text.replace(",", ".")) * 100);
}

/** O agente fica sem teto quando o valor digitado, arredondado para centavos, é zero. */
export function costCeilingIsNone(text: string): boolean {
  return costCeilingCents(text) === 0;
}

/** A dica do campo: zero é sem teto, e o aviso em destaque quando o valor digitado vai assim. */
export function CostCeilingHint({ t, value }: { t: typeof ptBR; value: string }): ReactNode {
  return (
    <>
      {t.costCeilingHint}
      {costCeilingIsNone(value) ? <strong className="block font-bold text-ink">{t.costCeilingNone}</strong> : null}
    </>
  );
}
