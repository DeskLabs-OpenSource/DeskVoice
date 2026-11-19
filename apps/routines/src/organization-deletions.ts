import { DEFAULT_RECORDINGS_DIR, executeOrganizationDeletion, withSystem, type Db } from "@deskvoice/core";
import { wahaEndSession, wahaFromEnv, wahaSessionName } from "@deskvoice/tools/waha";
import type { Logger } from "./log";
import type { RoutineDeps } from "./types";

/**
 * A rotina que termina a exclusão de organização (R8, fatia 9b; desenho em
 * docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, "Fatia 9").
 *
 * Não é uma tarefa de `tasks`: a tarefa seria da organização e sumiria na cascata do próprio
 * `delete`. O runner chama `run` na partida e a cada volta; a lápide (`deleting_at`) é o que faz a
 * exclusão retomar depois de um reinício.
 */

/** Quanto esperar para tentar de novo a exclusão que parou (o WAHA fora do ar, a pasta que não saiu). */
export const DELETION_RETRY_MS = 60_000;

/** As organizações com lápide, da mais antiga para a mais nova. Atravessa organizações: é a instalação que exclui. */
export async function pendingOrganizationDeletions(db: Db): Promise<string[]> {
  const rows = await withSystem(db, (q) => q.many<{ id: string }>("select id from organizations where deleting_at is not null order by deleting_at, id"));
  return rows.map((row) => row.id);
}

export interface OrganizationDeletions {
  /**
   * Termina as exclusões pendentes que não estão esperando a vez. Devolve daqui a quantos ms a
   * próxima que ficou para depois pode ser tentada, ou `undefined` se nenhuma ficou.
   */
  run(): Promise<number | undefined>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Uma exclusão que parou só é tentada de novo depois de `DELETION_RETRY_MS`, mesmo que o runner
 * acorde antes por outra tarefa: com o WAHA fora do ar, o runner não gira sem parar.
 */
export function createOrganizationDeletions(deps: RoutineDeps, log: Logger): OrganizationDeletions {
  const waitUntil = new Map<string, number>();
  const endWhatsAppSession = async (organizationId: string): Promise<void> => {
    const options = deps.waha ?? wahaFromEnv();
    // Sem a chave, este processo nunca falou com um WAHA: não há sessão para desfazer.
    if (!options.apiKey) return;
    await wahaEndSession(options, wahaSessionName(organizationId));
  };

  return {
    async run() {
      const pending = await pendingOrganizationDeletions(deps.db);
      for (const id of waitUntil.keys()) if (!pending.includes(id)) waitUntil.delete(id);
      let next: number | undefined;
      const later = (ms: number): void => {
        next = next === undefined ? ms : Math.min(next, ms);
      };
      for (const organizationId of pending) {
        const now = deps.clock.now().getTime();
        const until = waitUntil.get(organizationId);
        if (until !== undefined && until > now) {
          later(until - now);
          continue;
        }
        try {
          const result = await executeOrganizationDeletion(
            { db: deps.db, clock: deps.clock, recordingsDir: deps.recordingsDir ?? DEFAULT_RECORDINGS_DIR, endWhatsAppSession },
            organizationId,
          );
          if (result.status === "retry") {
            waitUntil.set(organizationId, now + DELETION_RETRY_MS);
            later(DELETION_RETRY_MS);
            log("error", "organization deletion stopped before the database; will try again", { organizationId, step: result.step, error: result.error });
            continue;
          }
          waitUntil.delete(organizationId);
          if (result.status === "deleted") log("info", "organization deleted", { organizationId, deletedAccounts: result.deletedAccounts });
        } catch (error) {
          waitUntil.set(organizationId, now + DELETION_RETRY_MS);
          later(DELETION_RETRY_MS);
          log("error", "organization deletion failed; will try again", { organizationId, error: messageOf(error) });
        }
      }
      return next;
    },
  };
}
