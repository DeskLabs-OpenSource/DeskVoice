import { createHash } from "node:crypto";
import { MAX_TASK_ATTEMPTS, enqueueTask, recordEvent, storedCallAnalysisSchema, withOrg, type OrgQuery } from "@deskvoice/core";
import { SafeFetchTimeoutError, loadAllowedWebhooks, postToWebhook, webhooksWanting, type RegisteredWebhook } from "@deskvoice/tools";
import { z } from "zod";
import type { Routine } from "../types";

/** O único acontecimento desta rotina, por enquanto: o relatório de cada ligação. */
const CALL_REPORT = "call.report";

const payloadSchema = z.object({ name: z.string().min(1), event: z.literal(CALL_REPORT) });

const OUTCOMES = ["booked", "callback_requested", "message_taken", "not_interested", "info_only", "unknown"] as const;

/**
 * O corpo que o webhook recebe. Estrito: campo novo entra aqui antes de sair, e nunca leva token,
 * chave ou segredo. Sem o telefone cadastrado de quem ligou (`from_e164`): o sistema do outro lado
 * liga o relatório à ligação pelo `callId`. Mas o `summary` e as `evidence` da análise são trechos
 * da fala: se quem ligou disse o número, ele sai. Não mascaramos o texto; a tela e o fragmento dizem
 * isso, e dizem que o que sai da instalação não é apagado no destino com o apagamento a pedido do
 * titular (decisão do Arquiteto, DESA-298).
 */
export const callReportSchema = z.strictObject({
  event: z.literal(CALL_REPORT),
  callId: z.uuid(),
  agentId: z.uuid().nullable(),
  direction: z.enum(["inbound", "outbound"]),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  endReason: z.string().nullable(),
  outcome: z.enum(OUTCOMES).nullable(),
  summary: z.string().nullable(),
  /** A análise como está guardada (inteira, ou a forma expurgada pelo prazo), com a nota da régua. */
  analysis: z.record(z.string(), z.unknown()).nullable(),
});
export type CallReport = z.infer<typeof callReportSchema>;

/** A mesma chave em toda tentativa da mesma entrega: quem respeita o cabeçalho não grava duas vezes. */
export const reportIdempotencyKey = (callId: string, name: string): string => createHash("sha256").update(`${callId}\n${CALL_REPORT}\n${name}`).digest("hex");

/**
 * Põe na fila o relatório da ligação para cada webhook que pediu `call.report`, dentro da transação
 * de quem chama (o fim de `classify_call_outcome`, ou o `summarize_call` quando o desfecho e a
 * análise estão desligados). Desligado de fábrica: sem webhook que peça, nada entra na fila.
 *
 * Uma vez por ligação e por webhook: a rotina que roda de novo não enfileira outra entrega se já há
 * a tarefa ou o desfecho dela na linha do tempo. A tarefa concluída sai na faxina de 7 dias; o
 * evento fica, e é ele a marca depois disso. Ligação apagada a pedido do titular não sai.
 */
export async function enqueueCallReports(q: OrgQuery, callId: string, at: Date): Promise<void> {
  const names = await webhooksWanting(q, CALL_REPORT);
  if (names.length === 0) return;
  const call = await q.one<{ erased: boolean }>("select erased_at is not null as erased from calls where id = $1", [callId]);
  if (!call || call.erased) return;
  for (const name of names) {
    const already = await q.one<{ n: number }>(
      `select (select count(*) from tasks where call_id = $1 and kind = 'deliver_webhook' and payload->>'name' = $2 and payload->>'event' = $3)
            + (select count(*) from call_events where call_id = $1 and kind in ('webhook_delivered', 'webhook_failed') and payload->>'name' = $2 and payload->>'event' = $3) as n`,
      [callId, name, CALL_REPORT],
    );
    if (Number(already?.n ?? 0) > 0) continue;
    const taskId = await enqueueTask(q, { kind: "deliver_webhook", payload: { name, event: CALL_REPORT }, callId });
    await recordEvent(q, callId, "task_queued", { taskId, kind: "deliver_webhook" }, at);
  }
}

/**
 * Por que a entrega não aconteceu, no vocabulário que a linha do tempo traduz:
 * - `http`: o webhook respondeu, com erro (o `status` vai junto);
 * - `timeout`: sem resposta no prazo do webhook;
 * - `unreachable`: o endereço não respondeu, ou a guarda de rede o recusou;
 * - `not_registered`: o webhook saiu da lista, ou deixou de pedir o relatório, depois de a entrega
 *   entrar na fila. Nada é enviado, e não há nova tentativa;
 * - `erased`: a ligação foi apagada a pedido de quem ligou. Nada é enviado.
 */
type DeliveryFailure = "http" | "timeout" | "unreachable" | "not_registered" | "erased";

interface ReportRow {
  agent_id: string | null;
  direction: "inbound" | "outbound";
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
  outcome: (typeof OUTCOMES)[number] | null;
  summary: string | null;
  analysis: unknown;
  analysis_score: number | null;
  erased: boolean;
}

function reportOf(callId: string, row: ReportRow): CallReport {
  const analysis = storedCallAnalysisSchema.safeParse(row.analysis);
  return callReportSchema.parse({
    event: CALL_REPORT,
    callId,
    agentId: row.agent_id,
    direction: row.direction,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    durationSeconds: row.ended_at ? Math.max(0, Math.round((row.ended_at.getTime() - row.started_at.getTime()) / 1000)) : null,
    endReason: row.end_reason,
    outcome: row.outcome,
    summary: row.summary,
    analysis: analysis.success ? { score: row.analysis_score, ...analysis.data } : null,
  });
}

/**
 * Entrega a um webhook cadastrado o relatório da ligação (`{ name, event: "call.report" }`). O
 * relatório é montado na hora, do banco: o resumo e a leitura que estão gravados agora, e não os do
 * momento em que a entrega entrou na fila. Vai com `Idempotency-Key`, a mesma em toda tentativa.
 *
 * Cada tentativa deixa `webhook_delivered` ou `webhook_failed` na linha do tempo da ligação. A que
 * falha lança erro, e a fila tenta de novo (`attempts`, até `MAX_TASK_ATTEMPTS`), sem tocar a
 * ligação nem as outras rotinas dela.
 */
const routine: Routine = {
  kind: "deliver_webhook",
  async run(task, deps) {
    if (!task.callId) throw new Error("deliver_webhook needs a task with callId");
    const callId = task.callId;
    const { name, event } = payloadSchema.parse(task.payload);
    const attempt = task.attempts;
    const retrying = attempt < MAX_TASK_ATTEMPTS;
    const record = (outcome: { ok: true; status: number } | { ok: false; reason: DeliveryFailure; status?: number; retrying: boolean }): Promise<void> =>
      withOrg(deps.db, task.organizationId, (q) =>
        recordEvent(
          q,
          callId,
          outcome.ok ? "webhook_delivered" : "webhook_failed",
          outcome.ok ? { name, event, status: outcome.status, attempt } : { name, event, reason: outcome.reason, status: outcome.status ?? null, attempt, retrying: outcome.retrying },
          deps.clock.now(),
        ),
      );

    const pronto = await withOrg(deps.db, task.organizationId, async (q): Promise<{ refused: "not_registered" | "erased" } | { hook: RegisteredWebhook; report: CallReport }> => {
      const hook = (await loadAllowedWebhooks(q, deps.secretKey)).find((candidate) => candidate.name === name);
      if (!hook?.events?.includes(event)) return { refused: "not_registered" };
      const row = await q.one<ReportRow>(
        `select agent_id, direction, started_at, ended_at, end_reason, outcome, summary, analysis, analysis_score, erased_at is not null as erased
           from calls where id = $1`,
        [callId],
      );
      if (!row) throw new Error(`Call ${callId} not found in this organization`);
      if (row.erased) return { refused: "erased" };
      return { hook, report: reportOf(callId, row) };
    });
    if ("refused" in pronto) return record({ ok: false, reason: pronto.refused, retrying: false });

    let failure: { reason: "http" | "timeout" | "unreachable"; status?: number };
    try {
      const response = await postToWebhook(pronto.hook, pronto.report, deps, reportIdempotencyKey(callId, name));
      if (response.ok) return record({ ok: true, status: response.status });
      failure = { reason: "http", status: response.status };
    } catch (cause) {
      // Recusado pela guarda, falha de rede, redirecionamento demais: o endereço não recebeu.
      failure = { reason: cause instanceof SafeFetchTimeoutError ? "timeout" : "unreachable" };
    }
    await record({ ok: false, ...failure, retrying });
    throw new Error(`Webhook ${name} did not take the ${event}: ${failure.reason}${failure.status !== undefined ? ` HTTP ${failure.status}` : ""}`);
  },
};

export default routine;
