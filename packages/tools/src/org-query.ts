import { withOrg, type Db, type OrgQuery } from "@deskvoice/core";

/**
 * `OrgQuery` que confirma cada consulta na própria transação. É o `q` que o `ToolContext` precisa:
 * uma ferramenta dura a ligação (`request_approval` espera minutos), e com uma transação só para
 * a chamada inteira o painel não veria a aprovação, nem a fila a tarefa, antes de ela terminar.
 */
export function autoCommitOrgQuery(db: Db, organizationId: string): OrgQuery {
  return {
    organizationId,
    many: (sql: string, params?: unknown[]) => withOrg(db, organizationId, (q) => q.many(sql, params)),
    one: (sql: string, params?: unknown[]) => withOrg(db, organizationId, (q) => q.one(sql, params)),
    exec: (sql: string, params?: unknown[]) => withOrg(db, organizationId, (q) => q.exec(sql, params)),
  };
}
