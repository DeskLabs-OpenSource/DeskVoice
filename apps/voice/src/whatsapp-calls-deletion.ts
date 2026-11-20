import { withSystem, type Db } from "@deskvoice/core";
import { messageOf, type Logger } from "./log";
import { WacallsError, isPaired, wacallsDeleteSession, wacallsListSessions, wacallsLogoutSession, wacallsSessionName, type WacallsOptions } from "./wacalls-client";

/**
 * A ligação pelo WhatsApp na exclusão de organização (fatia 9b2 do R8).
 *
 * Só este processo tem o token do WaCalls, e as rotinas não falam com ele: a conversa é pelo banco.
 * A rotina da exclusão (`executeOrganizationDeletion`) espera enquanto a linha de
 * `whatsapp_call_sessions` da organização com lápide tiver `wacalls_session_id`; este processo, de
 * minuto em minuto, despareia essas sessões no WaCalls e limpa a linha. Sem lápide nenhuma, nada
 * chama o WaCalls.
 */
export const WHATSAPP_CALLS_UNPAIR_MS = 60_000;

// Só as linhas das organizações com lápide: a organização viva nunca entra aqui.
const PENDING_SQL = `
  select s.organization_id as id
    from whatsapp_call_sessions s
    join organizations o on o.id = s.organization_id
   where o.deleting_at is not null and s.wacalls_session_id is not null
   order by s.organization_id`;

// A guarda da lápide fica no próprio `update`: a organização viva nunca é tocada, nem se a lápide
// sumir (por SQL) entre a consulta acima e aqui. `service_wanted` fica: a cascata o leva junto.
const CLEAR_SQL = `
  update whatsapp_call_sessions
     set wacalls_session_id = null, status = 'disconnected', failure = null, phone_e164 = null, connected_at = null, updated_at = $2
   where organization_id = $1
     and exists (select from organizations o where o.id = $1 and o.deleting_at is not null)`;

// Alguma organização da instalação quer a ligação pelo WhatsApp, a com lápide inclusive.
const WANTED_SQL = "select 1 as wanted from whatsapp_call_sessions where service_wanted limit 1";

export interface UnpairDeps {
  db: Db;
  options: WacallsOptions;
  log: Logger;
  now: () => Date;
}

/**
 * Despareia no WaCalls a sessão de cada organização com lápide que ainda tem `wacalls_session_id`, e
 * limpa a linha só depois de o WaCalls confirmar. Primeiro o `logout` (é ele que tira o aparelho do
 * celular), só da sessão pareada; depois o `delete`, que já tolera 404.
 *
 * - Sem token: este processo nunca teria criado sessão; limpa a linha e avisa no registro.
 * - WaCalls sem resposta (fora do ar ou sem resposta a tempo): limpa só se nenhuma organização quer o
 *   serviço, porque aí o WaCalls não sobe e não retoma sessão (a W1 da 9b). Se alguma quer, tenta de
 *   novo na próxima volta.
 * - Outra recusa do WaCalls (token, erro, resposta fora da forma): não limpa e tenta de novo.
 *
 * Um erro numa organização não para as outras. Nunca rejeita.
 */
export async function unpairDeletingOrganizations({ db, options, log, now }: UnpairDeps): Promise<void> {
  let pending: string[];
  try {
    pending = (await withSystem(db, (q) => q.many<{ id: string }>(PENDING_SQL))).map((row) => row.id);
  } catch (error) {
    log("error", "could not list the organizations being deleted with WhatsApp calls", { error: messageOf(error) });
    return;
  }
  if (pending.length === 0) return;

  const clear = (organizationId: string): Promise<number> => withSystem(db, (q) => q.exec(CLEAR_SQL, [organizationId, now()]));

  if (!options.token) {
    for (const organizationId of pending) {
      try {
        await clear(organizationId);
        log("error", "organization being deleted had a WhatsApp calls session, but this voice process has no WaCalls token; cleared the row", { organizationId });
      } catch (error) {
        log("error", "could not clear the WhatsApp calls row of an organization being deleted", { organizationId, error: messageOf(error) });
      }
    }
    return;
  }

  // Uma lista só para todas. Se o WaCalls não responde a ela, cada organização decide pela mesma falha.
  const listed = wacallsListSessions(options);
  listed.catch(() => undefined);

  for (const organizationId of pending) {
    try {
      const name = wacallsSessionName(organizationId);
      for (const session of (await listed).filter((candidate) => candidate.name === name)) {
        // Nesta ordem: sair com a sessão pareada é o que tira o aparelho do celular.
        if (isPaired(session)) await wacallsLogoutSession(options, session.id);
        await wacallsDeleteSession(options, session.id);
      }
      await clear(organizationId);
      log("info", "unpaired the WhatsApp calls session of an organization being deleted", { organizationId });
    } catch (error) {
      if (error instanceof WacallsError && (error.code === "unreachable" || error.code === "timeout")) {
        const wanted = await withSystem(db, (q) => q.one(WANTED_SQL)).catch(() => "unknown" as const);
        if (wanted === null) {
          await clear(organizationId).catch((clearError: unknown) =>
            log("error", "could not clear the WhatsApp calls row of an organization being deleted", { organizationId, error: messageOf(clearError) }),
          );
          log("info", "WaCalls did not answer and no organization wants WhatsApp calls; cleared the row of the organization being deleted", { organizationId, code: error.code });
          continue;
        }
        log("error", "WaCalls did not answer while unpairing an organization being deleted; will try again", { organizationId, code: error.code });
        continue;
      }
      const code = error instanceof WacallsError ? error.code : undefined;
      log("error", "could not unpair the WhatsApp calls session of an organization being deleted; will try again", { organizationId, code, error: messageOf(error) });
    }
  }
}
