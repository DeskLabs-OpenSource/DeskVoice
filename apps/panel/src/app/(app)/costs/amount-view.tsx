"use client";

import en from "../../../i18n/en/costs";
import es from "../../../i18n/es/costs";
import ptBR from "../../../i18n/pt-BR/costs";
import { useDict, useLocale } from "../../../i18n/provider";
import { formatMoney } from "../../../ui/format";
import { Badge } from "../../../ui/kit";
import { amountMarks } from "./amount";

/**
 * Um valor do extrato, o mesmo em Custos, no detalhe da chamada e na lista de Chamadas. Com linha
 * de custo não medido, o zero não é grátis: sem nada medido aparece só "não medido", e com parte
 * medida o valor vem com a marca de que falta uma parte. Com linha de custo estimado, a marca
 * "inclui estimativa" vem ao lado, inclusive do "não medido".
 */
export function Amount({ cents, unmeasuredCount, estimatedCount }: { cents: number; unmeasuredCount: number; estimatedCount: number }) {
  const t = useDict(ptBR, en, es);
  const locale = useLocale();
  const { shown, estimated } = amountMarks(cents, unmeasuredCount, estimatedCount);
  const estimate = estimated ? (
    <>
      {" "}
      <Badge tone="warn">{t.includesEstimate}</Badge>
    </>
  ) : null;
  if (shown === "unmeasured") {
    return (
      <>
        <Badge tone="warn">{t.unmeasured}</Badge>
        {estimate}
      </>
    );
  }
  return (
    <>
      {formatMoney(cents, locale)}
      {shown === "money-and-unmeasured" ? (
        <>
          {" "}
          <Badge tone="warn">{t.unmeasuredPart}</Badge>
        </>
      ) : null}
      {estimate}
    </>
  );
}
