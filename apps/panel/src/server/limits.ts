import { assertBelowLimit, ORGANIZATION_LIMIT_REACHED, type LimitKind, type OrgQuery } from "@deskvoice/core";
import { ApiError } from "./context";

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
