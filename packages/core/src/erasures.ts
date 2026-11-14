import { access, rm } from "node:fs/promises";
import { PURGED_ANALYSIS_SQL, PURGED_TRANSCRIPT, recordOrgEvent } from "./events";
import { enqueueTask } from "./queue";
import { recordingPath } from "./recordings";
import type { Db, OrgQuery } from "./types";
import { withOrg } from "./with-org";

/** O que fica no lugar de um texto apagado a pedido do titular (resumo, título de pendência, aviso). */
export const ERASED_TEXT = "[apagado a pedido do titular]";

/**
 * O que fica no lugar de uma fala apagada a pedido do titular. Herda o marcador do expurgo por prazo
 * (`purged`), para quem já lê `{ "purged": true }` continuar entendendo, e diz por que saiu (`erased`).
 */
export const ERASED_TRANSCRIPT = { ...PURGED_TRANSCRIPT, erased: true } as const;

/** A tarefa que apaga os arquivos de gravação das chamadas apagadas (o painel só lê a pasta). */
export const ERASE_RECORDINGS_TASK = "erase_recordings";

export interface ErasureCounts {
  calls: number;
  events: number;
  followUps: number;
  notifications: number;
  approvals: number;
  /** Arquivos de gravação que existiam e saem pela tarefa `erase_recordings`, depois do commit. */
  recordings: number;
}

const ERASED = `'{"erased": true}'::jsonb`;

/**
 * O que sai dos eventos das chamadas apagadas, regra por regra: cada uma diz quais eventos alcança e
 * como fica o payload. Fica o fato (tipo, horário, nome da ferramenta, para quem transferiu, quem
 * parou a gravação); sai a fala, o argumento, a mensagem e o telefone do titular. `$1` são as
 * chamadas; `$2`, o telefone, só nas regras que o usam.
 */
const EVENT_RULES: ReadonlyArray<{ where: string; set: string }> = [
  { where: "kind in ('transcript_user', 'transcript_agent') and payload ? 'text'", set: `'${JSON.stringify(ERASED_TRANSCRIPT)}'::jsonb` },
  // Mesmo marcador do prazo de guarda (`purgeTranscripts`), para a tela não aprender dois.
  { where: "kind = 'recording_paused' and payload ? 'reason'", set: `(payload - 'reason') || '{"reasonPurged": true}'::jsonb || ${ERASED}` },
  { where: "kind = 'tool_called' and payload ? 'args'", set: `(payload - 'args') || ${ERASED}` },
  { where: "kind = 'tool_result' and payload ?| array['message', 'error']", set: `(payload - array['message', 'error']) || ${ERASED}` },
  { where: "kind = 'approval_requested' and payload ?| array['question', 'context']", set: `(payload - array['question', 'context']) || ${ERASED}` },
  { where: "kind = 'human_notified' and payload ? 'message'", set: `(payload - 'message') || ${ERASED}` },
  // Só a transferência pedida pelo modelo tem `summary`, e o `reason` dela é texto livre. A do teto
  // de custo e a da falha do motor trazem um código (`cost_ceiling`, `engine_failed`) e ficam.
  { where: "kind = 'transfer_started' and payload ? 'summary'", set: `(payload - array['reason', 'summary']) || ${ERASED}` },
  { where: "kind = 'dtmf_sent' and payload ? 'digits'", set: `(payload - 'digits') || ${ERASED}` },
  // O telefone do titular em qualquer evento (`call_started`, `call_refused`) vira nulo; o da linha da empresa fica.
  { where: "payload->>'from' = $2", set: `jsonb_set(payload, '{from}', 'null'::jsonb) || ${ERASED}` },
  { where: "payload->>'to' = $2", set: `jsonb_set(payload, '{to}', 'null'::jsonb) || ${ERASED}` },
];

const paramsOf = (where: string, ids: string[], phoneE164: string): unknown[] => (where.includes("$2") ? [ids, phoneE164] : [ids]);

// Pendências do titular: pelo telefone ou pela chamada de onde nasceram. Avisos: das chamadas e dessas pendências.
const FOLLOW_UPS_WHERE = "(caller_e164 = $1 or call_id = any($2::uuid[]))";
const NOTIFICATIONS_WHERE = `(call_id = any($2::uuid[]) or follow_up_id in (select id from follow_ups where ${FOLLOW_UPS_WHERE}))`;

/**
 * Chamadas em que o telefone aparece — como quem ligou (`from_e164`) ou como destino de uma
 * ligação feita (`to_e164`). Já apagadas ficam de fora: é o que torna o mesmo pedido repetível sem
 * recontar nem reescrever.
 */
export async function callsOfCaller(q: OrgQuery, phoneE164: string): Promise<string[]> {
  const rows = await q.many<{ id: string }>("select id from calls where (from_e164 = $1 or to_e164 = $1) and erased_at is null order by started_at", [phoneE164]);
  return rows.map((row) => row.id);
}

/**
 * Há chamada desse telefone ainda viva? Enquanto houver, a sessão de voz segue gravando fala, eventos
 * e o arquivo de áudio depois do apagamento, e o pedido não estaria atendido: o apagamento espera.
 */
export async function hasLiveCall(q: OrgQuery, phoneE164: string): Promise<boolean> {
  const row = await q.one("select 1 from calls where (from_e164 = $1 or to_e164 = $1) and (status in ('ringing', 'in_progress') or ended_at is null) limit 1", [phoneE164]);
  return row !== null;
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
 * O que um pedido alcançaria agora, sem apagar nada. Conta com os mesmos filtros que `eraseCaller`
 * usa para escrever: o número da prévia é o número do recibo.
 */
export async function countCallerData(q: OrgQuery, options: { dir: string; phoneE164: string }): Promise<ErasureCounts & { live: boolean }> {
  const { dir, phoneE164 } = options;
  const ids = await callsOfCaller(q, phoneE164);
  const events = new Set<string>();
  for (const rule of EVENT_RULES) {
    const rows = await q.many<{ id: string }>(`select id from call_events where call_id = any($1::uuid[]) and ${rule.where}`, paramsOf(rule.where, ids, phoneE164));
    for (const row of rows) events.add(String(row.id));
  }
  const count = async (sql: string, params: unknown[]): Promise<number> => Number((await q.one<{ n: string }>(sql, params))?.n ?? 0);
  return {
    calls: ids.length,
    events: events.size,
    followUps: await count(`select count(*) as n from follow_ups where ${FOLLOW_UPS_WHERE}`, [phoneE164, ids]),
    notifications: await count(`select count(*) as n from notifications where ${NOTIFICATIONS_WHERE}`, [phoneE164, ids]),
    approvals: await count("select count(*) as n from approvals where call_id = any($1::uuid[])", [ids]),
    recordings: await countRecordings(dir, q.organizationId, ids),
    live: await hasLiveCall(q, phoneE164),
  };
}

/**
 * Atende o pedido de apagamento de um titular, numa transação só. Nas chamadas em que o telefone
 * aparece, sai toda fala e todo texto sobre a pessoa: as falas, o resumo, a citação do desfecho, o
 * texto da análise, o motivo do pedido para parar a gravação, os argumentos e mensagens de
 * ferramenta, o texto de aprovações e de avisos, e as pendências (pelo telefone e pela chamada). O
 * telefone do titular vira nulo nas chamadas, nos eventos e nas pendências.
 *
 * Fica o registro do serviço prestado — horário, duração, custo, desfecho, nota da análise, quem
 * parou a gravação —, porque não é fala de ninguém e sustenta fatura e relatório. Fica também a
 * lista de não ligar: tirar o número de lá voltaria a permitir ligar para quem pediu que não.
 *
 * Os arquivos de gravação não saem aqui: o painel monta a pasta só para leitura, e o arquivo apagado
 * antes do commit não voltaria se a transação desfizesse. A transação enfileira `erase_recordings`,
 * que só fica visível quando o banco confirma; a rotina apaga os arquivos de toda chamada com
 * `erased_at`, então um arquivo que tenha ficado sai na próxima execução, sem recontar o banco.
 *
 * Recusa (`"live_call"`) enquanto houver chamada viva desse telefone. Só dentro de `withOrg`: numa
 * transação de sistema o mesmo `update` alcançaria todas as organizações.
 */
export async function eraseCaller(q: OrgQuery, options: { dir: string; phoneE164: string; now: Date }): Promise<ErasureCounts | "live_call"> {
  if (q.organizationId === "") throw new Error("eraseCaller runs inside withOrg, never withSystem: it would reach every organization");
  const { dir, phoneE164, now } = options;
  if (await hasLiveCall(q, phoneE164)) return "live_call";

  const ids = await callsOfCaller(q, phoneE164);
  const recordings = await countRecordings(dir, q.organizationId, ids);

  const events = new Set<string>();
  for (const rule of EVENT_RULES) {
    const rows = await q.many<{ id: string }>(
      `update call_events set payload = ${rule.set} where call_id = any($1::uuid[]) and ${rule.where} returning id`,
      paramsOf(rule.where, ids, phoneE164),
    );
    for (const row of rows) events.add(String(row.id));
  }

  // Os avisos antes das pendências: o filtro dos avisos acha as pendências pelo telefone, que sai delas a seguir.
  const notifications = await q.exec(`update notifications set body = $3 where ${NOTIFICATIONS_WHERE}`, [phoneE164, ids, ERASED_TEXT]);
  const followUps = await q.exec(`update follow_ups set title = $3, details = '', closing_note = null, caller_e164 = null where ${FOLLOW_UPS_WHERE}`, [
    phoneE164,
    ids,
    ERASED_TEXT,
  ]);
  const approvals = await q.exec(`update approvals set question = $2, context = ${ERASED} where call_id = any($1::uuid[])`, [ids, ERASED_TEXT]);

  const calls = await q.exec(
    `update calls set
       summary = case when summary is null then null else $2 end,
       outcome_evidence = null,
       analysis = case when analysis is null or analysis ? 'purged' then analysis else ${PURGED_ANALYSIS_SQL} end,
       recording_pause_reason = null,
       from_e164 = case when from_e164 = $1 then null else from_e164 end,
       to_e164 = case when to_e164 = $1 then null else to_e164 end,
       erased_at = $3
     where id = any($4::uuid[]) and erased_at is null`,
    [phoneE164, ERASED_TEXT, now, ids],
  );

  const queued = await q.one("select 1 from tasks where kind = $1 and status = 'queued'", [ERASE_RECORDINGS_TASK]);
  const erasedBefore = await q.one("select 1 from calls where erased_at is not null limit 1");
  if (!queued && erasedBefore) await enqueueTask(q, { kind: ERASE_RECORDINGS_TASK, payload: {}, runAt: now });

  return { calls, events: events.size, followUps, notifications, approvals, recordings };
}

/**
 * Apaga os arquivos de gravação de toda chamada apagada a pedido do titular nesta organização, e
 * registra quantos saíram e quantos ficaram. Arquivo que já não existe não conta. Arquivo que não
 * sai fica contado em `left`, com o motivo: quem chama decide repetir (a rotina lança, e a fila
 * tenta de novo).
 *
 * ponytail: passa por todas as chamadas com `erased_at` a cada execução; são só as apagadas a pedido,
 * poucas. Se crescerem, uma coluna `recording_erased_at` limita a varredura às pendentes.
 */
export async function removeErasedRecordings(db: Db, options: { dir: string; organizationId: string; now: Date }): Promise<{ removed: number; left: number; errors: string[] }> {
  const { dir, organizationId, now } = options;
  const ids = await withOrg(db, organizationId, (q) => q.many<{ id: string }>("select id from calls where erased_at is not null"));
  let removed = 0;
  const errors: string[] = [];
  for (const { id } of ids) {
    try {
      await rm(recordingPath(dir, organizationId, id));
      removed += 1;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const left = errors.length;
  if (removed > 0 || left > 0) await withOrg(db, organizationId, (q) => recordOrgEvent(q, "caller_recordings_erased", { removed, left }, now));
  return { removed, left, errors };
}
