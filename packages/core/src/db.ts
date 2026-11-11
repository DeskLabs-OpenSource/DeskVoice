import { Pool } from "pg";
import type { Db } from "./types";

/**
 * `url` é a conexão do papel de aplicação, sujeita a RLS. `systemUrl` é a do papel de sistema;
 * sem ela o `Db` serve para tudo menos `withSystem` e a fila.
 */
export function createDb(url: string, systemUrl?: string): Db {
  const pool = openPool(url);
  const systemPool = systemUrl === undefined ? undefined : openPool(systemUrl);
  return {
    pool,
    systemPool,
    async close() {
      await Promise.all([pool.end(), systemPool?.end()]);
    },
  };
}

function openPool(url: string): Pool {
  const pool = new Pool({ connectionString: url });
  // Conexão ociosa que cai (banco reiniciou) emite `error` no pool, e evento `error` sem ouvinte
  // derruba o processo. O pool já descarta essa conexão; a falha real, se houver, aparece na
  // próxima consulta, para quem pode tratá-la.
  pool.on("error", () => undefined);
  return pool;
}

/**
 * Escuta um canal de NOTIFY (`tasks`, `approvals`, `call_events`). Devolve a função que encerra
 * a escuta. Cada escuta segura uma conexão do pool enquanto durar.
 *
 * Se a conexão cair, a escuta acabou: `onError` é chamado para quem quiser reabrir. Sem
 * `onError` o erro derruba o processo de propósito, porque escuta morta em silêncio é fila
 * parada sem ninguém saber.
 */
export async function listen(
  db: Db,
  channel: string,
  onPayload: (payload: string) => void,
  onError?: (error: Error) => void,
): Promise<() => Promise<void>> {
  // O nome do canal entra no texto do comando: LISTEN não aceita parâmetro.
  if (!/^[a-z_][a-z0-9_]*$/.test(channel)) throw new Error(`Invalid channel name: ${JSON.stringify(channel)}`);

  const client = await db.pool.connect();
  let open = true;
  client.on("notification", (message) => {
    if (message.channel === channel) onPayload(message.payload ?? "");
  });
  client.on("error", (error) => {
    open = false;
    client.release(error);
    if (!onError) throw error;
    onError(error);
  });

  try {
    await client.query(`listen ${channel}`);
  } catch (error) {
    open = false;
    client.release(true);
    throw error;
  }

  return async () => {
    if (!open) return;
    open = false;
    client.removeAllListeners("notification");
    // Destrói a conexão em vez de devolvê-la ao pool: é o que garante que nenhum LISTEN sobra nela.
    client.release(true);
  };
}
