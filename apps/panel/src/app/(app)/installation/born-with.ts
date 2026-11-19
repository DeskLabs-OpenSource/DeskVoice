import { fill } from "../../../i18n/locales";
import type { InstallationDictionary } from "../../../i18n/pt-BR/installation";

/** Os limites com que uma organização nova nasce (`GET /installation/defaults/limits`, fatia 7d). */
export interface DefaultLimits {
  maxTrunks: number | null;
  maxAgents: number | null;
  monthlySpendCapCents: number | null;
  /** `false`: a organização nova nasce com a saída travada (o padrão de fábrica). */
  outboundAllowed: boolean;
}

/** A frase curta do formulário de nova organização: "Ela nasce com: ..., saída travada." */
export function bornWithText(limits: DefaultLimits, t: InstallationDictionary["organizations"], money: (cents: number) => string): string {
  const parts = [
    limits.maxTrunks === null ? t.bornTrunksNone : fill(t.bornTrunks, { n: limits.maxTrunks }),
    limits.maxAgents === null ? t.bornAgentsNone : fill(t.bornAgents, { n: limits.maxAgents }),
    limits.monthlySpendCapCents === null ? t.bornSpendCapNone : fill(t.bornSpendCap, { cap: money(limits.monthlySpendCapCents) }),
    limits.outboundAllowed ? t.bornOutboundDecide : t.bornOutboundBlocked,
  ];
  return fill(t.bornWith, { limits: parts.join(", ") });
}
