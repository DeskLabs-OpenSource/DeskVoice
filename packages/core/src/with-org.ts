import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { Db, OrgQuery } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Roda `fn` numa transação presa à organização: as policies de RLS só deixam ver e gravar
 * linhas dela. Confirma se `fn` devolver, desfaz se lançar.
 */
export function withOrg<T>(db: Db, organizationId: string, fn: (q: OrgQuery) => Promise<T>): Promise<T> {
  if (!UUID.test(organizationId)) return Promise.reject(new Error(`withOrg: invalid organization id ${JSON.stringify(organizationId)}`));
  return transaction(db.pool, organizationId, fn);
}

/**
 * Transação que atravessa organizações, pelo papel de sistema (`db.systemPool`). Só para o que
 * não tem como saber a organização antes de consultar: login por e-mail, fila de tarefas,
 * roteamento da chamada pelo número discado. Nunca passe para dentro dela SQL montado com texto
 * de fora. `q.organizationId` vem vazio; toda gravação precisa informar a organização da linha.
 */
export function withSystem<T>(db: Db, fn: (q: OrgQuery) => Promise<T>): Promise<T> {
  if (!db.systemPool) {
    return Promise.reject(new Error("withSystem: this Db has no system pool. Create it with createDb(url, systemUrl) (SYSTEM_DATABASE_URL)."));
  }
  return transaction(db.systemPool, "", fn);
}

async function transaction<T>(pool: Pool, organizationId: string, fn: (q: OrgQuery) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("begin");
    // Terceiro argumento `true`: vale só nesta transação, então não vaza para o próximo uso da conexão.
    if (organizationId !== "") await client.query("select set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await fn(orgQuery(client, organizationId));
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      // Sem rollback a conexão não pode voltar ao pool com a transação aberta: é descartada.
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

function orgQuery(client: PoolClient, organizationId: string): OrgQuery {
  return {
    organizationId,
    async many<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
      return (await client.query<T>(sql, params)).rows;
    },
    async one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null> {
      return (await client.query<T>(sql, params)).rows[0] ?? null;
    },
    async exec(sql: string, params?: unknown[]): Promise<number> {
      return (await client.query(sql, params)).rowCount ?? 0;
    },
  };
}
