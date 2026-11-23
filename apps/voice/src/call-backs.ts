import {
  CALL_BACK_COLUMNS,
  CALL_BACK_EXPIRE_AFTER_MINUTES,
  CALL_BACKS_CHANNEL,
  dueCallBacks,
  enqueueTask,
  isCallBackRefusalCode,
  listen,
  settleCallBack,
  withOrg,
  type CallBackRow,
} from "@deskvoice/core";
import { messageOf } from "./log";
import { startOutboundCall, type OutboundDeps } from "./outbound";
import { realSchedule, type Schedule } from "./transport";

/**
 * A religação, do lado do processo de voz (desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seção
 * 3.6, passos 3 e 4). A rotina `call_back` passa a linha a `due` e avisa no canal `call_backs`; aqui a
 * linha é reivindicada (`for update skip locked`: dois processos de voz nunca pegam a mesma) e vira
 * chamada **só por `startOutboundCall`**, que confere a política de saída (`checkOutboundAllowed`) na
 * mesma transação que cria a chamada. A política é conferida na hora de discar, e não na de agendar.
 *
 * Ao subir, e a cada vez que a escuta reabre, uma varredura pega o que ficou `due` com o processo
 * parado. A linha `due` há mais de 1 hora (`CALL_BACK_EXPIRE_AFTER_MINUTES`) vira `expired`, sem discar.
 */

export interface CallBacks {
  /** Varre as linhas `due` agora. Resolve quando a varredura (e a que ela pediu) termina. */
  sweep(): Promise<void>;
  close(): Promise<void>;
}

const RELISTEN_MS = 1000;
const MINUTE_MS = 60 * 1000;
const SWEEP_BATCH = 50;

/** Reivindica e resolve UMA linha `due`, na organização dela. Sem a linha (outro processo a tem, ou já saiu), nada. */
export async function placeCallBack(deps: OutboundDeps, organizationId: string, callBackId: string): Promise<void> {
  const { db, clock, log } = deps;
  await withOrg(db, organizationId, async (q) => {
    // A linha fica travada até o fim: outro processo de voz pula, e a revisão da religação espera.
    const row = await q.one<CallBackRow>(`select ${CALL_BACK_COLUMNS} from call_backs where id = $1 and status = 'due' for update skip locked`, [callBackId]);
    if (!row) return;
    const now = clock.now();

    if (row.due_at.getTime() < now.getTime() - CALL_BACK_EXPIRE_AFTER_MINUTES * MINUTE_MS) {
      await q.exec("update call_backs set status = 'expired' where id = $1", [row.id]);
      await settleCallBack(q, row, { action: "call_back_expired" }, now);
      return;
    }
    if (row.to_e164 === null || row.agent_id === null) {
      // O número foi apagado a pedido do titular (o apagamento já cancela), ou o agente foi apagado.
      if (row.to_e164 === null) await q.exec("update call_backs set status = 'cancelled' where id = $1", [row.id]);
      else {
        await q.exec("update call_backs set status = 'refused', refusal_code = 'agent_not_found' where id = $1", [row.id]);
        await settleCallBack(q, row, { action: "call_back_refused", refusalCode: "agent_not_found" }, now);
      }
      return;
    }

    // Cada tentativa cria no máximo uma chamada com `call_back_of`. Se já existem tantas quantas a
    // tentativa, o processo caiu depois de discar e antes de gravar: não disca de novo, e a revisão
    // daquela chamada resolve o resultado.
    const before = await q.many<{ id: string }>("select id from calls where call_back_of = $1 order by started_at, id", [row.origin_call_id]);
    if (before.length >= row.attempt) {
      const last = before[before.length - 1]?.id ?? null;
      await q.exec("update call_backs set status = 'placed', result_call_id = $2 where id = $1", [row.id, last]);
      if (last) await enqueueTask(q, { kind: "review_call", payload: {}, callId: last, runAt: now });
      return;
    }

    const result = await startOutboundCall(deps, { organizationId, agentId: row.agent_id, toE164: row.to_e164, callBackOf: row.origin_call_id });
    const known = new Set(before.map((call) => call.id));
    const created = (await q.many<{ id: string }>("select id from calls where call_back_of = $1 order by started_at, id", [row.origin_call_id])).find((call) => !known.has(call.id))?.id;

    if ("callId" in result) {
      await q.exec("update call_backs set status = 'placed', result_call_id = $2 where id = $1", [row.id, result.callId]);
      await settleCallBack(q, row, { action: "call_back_placed", callId: result.callId }, clock.now());
      return;
    }
    // A recusa da política já fica gravada na chamada `refused`, com `call_refused`; a recusa antes da
    // chamada (número inválido, agente, linha) e a falha de originar ficam aqui, com o código.
    const refusalCode = isCallBackRefusalCode(result.code) ? result.code : "originate_failed";
    if (!isCallBackRefusalCode(result.code)) log("error", "unexpected refusal code from the outbound call", { callBackId: row.id, code: result.code });
    await q.exec("update call_backs set status = 'refused', refusal_code = $2, result_call_id = $3 where id = $1", [row.id, refusalCode, created ?? null]);
    await settleCallBack(q, row, { action: "call_back_refused", refusalCode, ...(created !== undefined && { callId: created }) }, clock.now());
  });
}

/**
 * Escuta o canal `call_backs` e varre as linhas `due`: ao subir, a cada aviso e a cada vez que a
 * escuta reabre (um aviso pode ter passado com ela fechada). Uma varredura de cada vez por processo.
 */
export async function startCallBacks(deps: OutboundDeps & { schedule?: Schedule }): Promise<CallBacks> {
  const schedule = deps.schedule ?? realSchedule;
  const { db, log } = deps;
  let closed = false;
  let stop: (() => Promise<void>) | undefined;
  let cancelRelisten: (() => void) | undefined;
  let running: Promise<void> | undefined;
  let again = false;

  async function sweepOnce(): Promise<void> {
    for (const row of await dueCallBacks(db, SWEEP_BATCH)) {
      if (closed) return;
      try {
        await placeCallBack(deps, row.organizationId, row.id);
      } catch (error) {
        // A linha volta a `due` (a transação desfez): a próxima varredura tenta de novo, até expirar.
        log("error", "could not place the call-back", { callBackId: row.id, error: messageOf(error) });
      }
    }
  }

  function sweep(): Promise<void> {
    if (closed) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await sweepOnce();
        } while (again && !closed);
      } catch (error) {
        log("error", "could not sweep the call-backs", { error: messageOf(error) });
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  async function open(): Promise<void> {
    stop = await listen(
      db,
      CALL_BACKS_CHANNEL,
      () => void sweep(),
      (error) => {
        log("error", "call-backs listener lost; reopening", { error: error.message });
        stop = undefined;
        reopen();
      },
    );
    void sweep();
  }

  function reopen(): void {
    if (closed) return;
    cancelRelisten = schedule(() => {
      open().catch((error: unknown) => {
        log("error", "could not reopen the call-backs listener; will retry", { error: messageOf(error) });
        reopen();
      });
    }, RELISTEN_MS);
  }

  await open();

  return {
    sweep,
    async close() {
      closed = true;
      cancelRelisten?.();
      await stop?.();
      await running;
    },
  };
}
