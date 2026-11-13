import { access, rm } from "node:fs/promises";
import { PURGED_TRANSCRIPT } from "./events";
import { recordingPath } from "./recordings";
import type { OrgQuery } from "./types";

/**
 * O que fica no lugar do texto apagado: a linha do tempo mostra que houve fala, sem a fala. Mesmo
 * marcador do expurgo por prazo (`purgeTranscripts`), para quem lê a tela não precisar aprender
 * dois vocabulários.
 */
export const ERASED_TEXT = "[apagado a pedido do titular]";

export interface ErasureCounts {
  calls: number;
  events: number;
  recordings: number;
  followUps: number;
}

/**
 * Chamadas em que o telefone aparece — como quem ligou (`from_e164`) ou como destino de uma
 * ligação feita (`to_e164`). Já apagadas ficam de fora: é o que torna o mesmo pedido repetível sem
 * recontar nem reescrever.
 */
export async function callsOfCaller(q: OrgQuery, phoneE164: string): Promise<Array<{ id: string }>> {
  return q.many<{ id: string }>(
    "select id from calls where (from_e164 = $1 or to_e164 = $1) and erased_at is null order by started_at",
    [phoneE164],
  );
}

/**
 * O que um pedido alcançaria agora. É a conta que a prévia mostra antes de qualquer coisa ser
 * apagada: apagar é irreversível, então quem confirma precisa ver o tamanho do que sai.
 */
export async function countCallerData(q: OrgQuery, phoneE164: string): Promise<ErasureCounts> {
  const row = await q.one<{ calls: string; events: string; follow_ups: string }>(
    `select
       (select count(*) from calls where (from_e164 = $1 or to_e164 = $1) and erased_at is null) as calls,
       (select count(*)
          from call_events e
          join calls c on c.organization_id = e.organization_id and c.id = e.call_id
         where (c.from_e164 = $1 or c.to_e164 = $1) and c.erased_at is null
           and e.kind in ('transcript_user', 'transcript_agent') and e.payload ? 'text') as events,
       (select count(*) from follow_ups where caller_e164 = $1) as follow_ups`,
    [phoneE164],
  );
  return {
    calls: Number(row?.calls ?? 0),
    events: Number(row?.events ?? 0),
    recordings: 0,
    followUps: Number(row?.follow_ups ?? 0),
  };
}

/** Quantos arquivos de gravação existem hoje para estas chamadas (a conta é do disco, não do banco). */
export async function countRecordings(dir: string, organizationId: string, callIds: string[]): Promise<number> {
  let found = 0;
  for (const callId of callIds) {
    const exists = await access(recordingPath(dir, organizationId, callId)).then(
      () => true,
      () => false,
    );
    if (exists) found += 1;
  }
  return found;
}

/**
 * Atende o pedido: apaga o áudio, troca as falas pelo marcador e zera o resumo e a citação do
 * desfecho; o telefone do titular naquelas chamadas é anonimizado (o outro lado fica: é a linha da
 * empresa). O que não era fala de ninguém permanece — horário, duração, custo, desfecho, status —
 * porque é o registro do serviço prestado, e apagá-lo quebraria fatura e relatório.
 *
 * As pendências são mascaradas, não apagadas: pendência aberta é obrigação em curso e some só
 * quando fechada. Só dentro de `withOrg`: numa transação de sistema o mesmo `update` alcançaria
 * todas as organizações.
 */
export async function eraseCaller(
  q: OrgQuery,
  options: { dir: string; organizationId: string; phoneE164: string; now: Date },
): Promise<ErasureCounts> {
  if (q.organizationId === "") throw new Error("eraseCaller runs inside withOrg, never withSystem: it would reach every organization");

  const { dir, organizationId, phoneE164, now } = options;
  const calls = await callsOfCaller(q, phoneE164);
  if (calls.length === 0) return { calls: 0, events: 0, recordings: 0, followUps: 0 };
  const ids = calls.map((call) => call.id);

  let recordings = 0;
  for (const callId of ids) {
    const file = recordingPath(dir, organizationId, callId);
    const exists = await access(file).then(
      () => true,
      () => false,
    );
    if (!exists) continue;
    await rm(file, { force: true });
    recordings += 1;
  }

  const events = await q.exec(
    "update call_events set payload = $1 where call_id = any($2::uuid[]) and kind in ('transcript_user', 'transcript_agent') and payload ? 'text'",
    [JSON.stringify(PURGED_TRANSCRIPT), ids],
  );

  const callsTouched = await q.exec(
    `update calls set
       summary = case when summary is null then null else $2 end,
       outcome_evidence = null,
       from_e164 = case when from_e164 = $1 then null else from_e164 end,
       to_e164 = case when to_e164 = $1 then null else to_e164 end,
       erased_at = $3
     where id = any($4::uuid[]) and erased_at is null`,
    [phoneE164, ERASED_TEXT, now, ids],
  );

  const followUps = await q.exec("update follow_ups set title = $2, details = '', closing_note = null where caller_e164 = $1", [
    phoneE164,
    ERASED_TEXT,
  ]);

  return { calls: callsTouched, events, recordings, followUps };
}
