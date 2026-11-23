import { assertBelowLimit, MAX_COUNT_LIMIT, MAX_SPEND_CAP_CENTS, ORGANIZATION_LIMIT_REACHED, type LimitKind, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { ApiError } from "./context";

// `null` tira o limite. `outboundAllowed` é sim ou não, nunca nulo (a coluna é `not null`). O teto do
// mês é em centavos (de dólar, a moeda do extrato), até o maior `integer` do Postgres. Campo
// desconhecido é recusado. Os tetos são os do core, que a leitura de `defaults.limits` também confere.
const limit = z.number().int().min(0).max(MAX_COUNT_LIMIT).nullable();
const spendCap = z.number().int().min(0).max(MAX_SPEND_CAP_CENTS).nullable();

/**
 * O corpo do `PUT` dos limites: o de uma organização (`installation/organizations/[id]/limits`) e o do
 * padrão das organizações novas (`installation/defaults/limits`), com as mesmas regras.
 */
export const limitsBody = z.object({ maxTrunks: limit, maxAgents: limit, outboundAllowed: z.boolean().optional(), monthlySpendCapCents: spendCap.optional() }).strict();

const NOUN: Record<LimitKind, string> = { trunks: "phone lines", agents: "agents" };

/**
 * Recusa a criação de uma linha telefônica ou de um agente acima do limite que a administração da
 * instalação definiu (seção 3.4 do R8). Chame na mesma transação do `insert`, antes dele: a trava da
 * organização é de `assertBelowLimit` e segura até o fim da transação. Só a criação confere; editar,
 * ligar ou desligar o que já existe não passa por aqui.
 */
export async function requireBelowLimit(q: OrgQuery, kind: LimitKind): Promise<void> {
  const result = await assertBelowLimit(q, kind);
  if (result.ok) return;
  throw new ApiError(
    409,
    ORGANIZATION_LIMIT_REACHED,
    `This organization already has ${result.count} ${NOUN[kind]}; the limit set by the installation administration is ${result.limit}.`,
    { kind, count: result.count, limit: result.limit },
  );
}
