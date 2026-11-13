import { decryptSecret, recordEvent, withOrg } from "@deskvoice/core";
import { OUTCOME_SETTING, loadEngines, outcomeEnabledOf, settleOutcome, type CallOutcome } from "@deskvoice/voice-engine";
import type { Routine } from "../types";

/** Mesmo nome que o painel usa: a chave do motor, cifrada. */
const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;

/** Uma ligação longa não precisa inteira: o desfecho mora no fim da conversa. */
const TRANSCRIPT_LIMIT = 6000;

interface Pendente {
  engineId: string;
  stored: string;
  transcript: string;
  tools: string[];
}

/**
 * Diz o que aconteceu na ligação — o desfecho comercial, não o relato técnico.
 *
 * Desligado de fábrica: só roda com `calls.outcome_enabled` ligado pelo dono, porque cada ligação
 * classificada é uma chamada paga ao provedor, com a transcrição em texto.
 *
 * A classificação é do **motor do agente**: quem fala é quem lê, e a chave já está guardada. Sem
 * motor que classifique ou sem chave, nada é gravado: a ligação fica sem desfecho e a próxima
 * execução, quando a chave existir, classifica.
 *
 * O custo segue o caminho do custo da voz: uma linha no extrato (`usage_ledger`) e a soma em
 * `calls.cost_cents`. Ligação que já atingiu o teto de custo do agente não é classificada. Falha
 * do provedor e teto atingido viram `outcome_not_classified` na linha do tempo, com o motivo.
 *
 * Roda depois de `summarize_call`, que é quem enfileira. A chamada ao provedor acontece fora da
 * transação (leva até dez segundos) e não lança: falha não devolve a tarefa à fila para pagar de novo.
 */
const routine: Routine = {
  kind: "classify_call_outcome",
  async run(task, deps) {
    if (!task.callId) throw new Error("classify_call_outcome needs a task with callId");
    const callId = task.callId;

    const pendente = await withOrg(deps.db, task.organizationId, async (q): Promise<Pendente | null> => {
      // Desligado de fábrica. A tarefa pode ter entrado na fila antes de alguém desligar: confere de novo.
      const ligado = await q.one<{ value: unknown }>("select value from settings where key = $1", [OUTCOME_SETTING]);
      if (!outcomeEnabledOf(ligado?.value)) return null;

      const call = await q.one<{ agent_id: string | null; outcome: CallOutcome | null; cost_cents: number }>("select agent_id, outcome, cost_cents from calls where id = $1", [callId]);
      if (!call) throw new Error(`Call ${callId} not found in this organization`);
      // Já classificado: chamar o provedor de novo custaria dinheiro para escrever o mesmo.
      if (call.outcome !== null || call.agent_id === null) return null;

      const agent = await q.one<{ engine: string; cost_ceiling_cents: number }>("select engine, cost_ceiling_cents from agents where id = $1", [call.agent_id]);
      if (!agent) return null;

      const events = await q.many<{ kind: string; text: string | null; name: string | null }>(
        `select kind, payload->>'text' as text, payload->>'name' as name from call_events
          where call_id = $1 and kind in ('transcript_user', 'transcript_agent', 'tool_called') order by id`,
        [callId],
      );
      const falas = events.flatMap((event) =>
        event.kind !== "tool_called" && event.text ? [`${event.kind === "transcript_user" ? "Cliente" : "Agente"}: ${event.text}`] : [],
      );
      const toolNames = [...new Set(events.flatMap((event) => (event.kind === "tool_called" && event.name ? [event.name] : [])))];
      // Sem fala nenhuma não há o que ler: melhor não gastar uma chamada para responder "unknown".
      if (falas.length === 0) return null;

      const chave = await q.one<{ value: unknown }>("select value from settings where key = $1", [engineKeySetting(agent.engine)]);
      if (typeof chave?.value !== "string") return null;

      // O mesmo teto da voz: zero é "sem teto". Chegou nele, não gasta mais nada nesta ligação.
      // ponytail: confere o que já foi gasto, não o que a classificação vai custar; ela pode passar
      // do teto pelo próprio valor (centavos). Estimar antes pede um limite de tokens de saída.
      if (agent.cost_ceiling_cents > 0 && call.cost_cents >= agent.cost_ceiling_cents) {
        await recordEvent(q, callId, "outcome_not_classified", { reason: "cost_ceiling", engine: agent.engine, costCents: call.cost_cents, ceilingCents: agent.cost_ceiling_cents }, deps.clock.now());
        return null;
      }

      return {
        engineId: agent.engine,
        // Decifrar fora daqui mantém o texto cifrado o tempo todo no banco; o claro vive só na memória.
        stored: chave.value,
        transcript: falas.join("\n").slice(-TRANSCRIPT_LIMIT),
        tools: toolNames,
      };
    });
    if (!pendente) return;

    const engines = await loadEngines();
    const engine = engines.get(pendente.engineId);
    if (!engine?.classifyOutcome) return;

    const result = await engine.classifyOutcome(decryptSecret(pendente.stored, deps.secretKey), { transcript: pendente.transcript, tools: pendente.tools }, { fetch: deps.fetch });

    const now = deps.clock.now();
    await withOrg(deps.db, task.organizationId, async (q) => {
      const { usage, costCents } = result;
      const inputTokens = (usage.inputTokens ?? 0) + (usage.textInputTokens ?? 0) + (usage.cachedInputTokens ?? 0);
      const outputTokens = (usage.outputTokens ?? 0) + (usage.textOutputTokens ?? 0);
      // O que o provedor cobrou entra no extrato e no custo da chamada, como o consumo da voz.
      if (inputTokens > 0 || outputTokens > 0 || costCents > 0) {
        await q.exec("insert into usage_ledger (organization_id, call_id, engine, input_tokens, output_tokens, cost_cents, at) values ($1, $2, $3, $4, $5, $6, $7)", [
          q.organizationId,
          callId,
          pendente.engineId,
          inputTokens,
          outputTokens,
          costCents,
          now,
        ]);
        await q.exec("update calls set cost_cents = cost_cents + $2 where id = $1", [callId, costCents]);
      }

      if (!result.ok) {
        // Sem a chave e sem o corpo do provedor: o motivo no vocabulário fechado e o status bastam.
        await recordEvent(q, callId, "outcome_not_classified", { reason: result.failure, engine: pendente.engineId, model: result.model, status: result.status, costCents }, now);
        return;
      }
      const decidido = settleOutcome(result.guess);
      await q.exec("update calls set outcome = $2, outcome_confidence = $3, outcome_evidence = $4, outcome_classified_at = $5 where id = $1 and outcome is null", [
        callId,
        decidido.outcome,
        decidido.confidence,
        decidido.evidence,
        now,
      ]);
    });
  },
};

export default routine;
