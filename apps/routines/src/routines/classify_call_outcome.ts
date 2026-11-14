import { RUBRIC_VERSION, callAnalysisSchema, decryptSecret, recordEvent, scoreOf, verifyAgainstTranscript, withOrg, type OrgQuery, type TranscriptTurn } from "@deskvoice/core";
import {
  ANALYSIS_SETTING,
  OUTCOME_SETTING,
  analysisEnabledOf,
  loadEngines,
  outcomeEnabledOf,
  settleOutcome,
  type CallOutcome,
  type ClassifyFailure,
  type ClassifyResult,
} from "@deskvoice/voice-engine";
import type { Routine } from "../types";

/** Mesmo nome que o painel usa: a chave do motor, cifrada. */
const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;

/** Uma ligação longa não precisa inteira: o desfecho mora no fim da conversa. */
const TRANSCRIPT_LIMIT = 6000;

/** Por que a análise não foi pedida, ou não foi gravada. */
type AnalysisNotDoneReason = "no_speech" | "no_key" | "engine_cannot_analyze" | "cost_ceiling" | ClassifyFailure;

interface Pendente {
  engineId: string;
  stored: string;
  /** O desfecho foi pedido pelo dono (`calls.outcome_enabled`) e ainda não está gravado. */
  outcome: boolean;
  /** A análise foi pedida (`calls.analysis_enabled`), dá para pedir e ainda não está gravada. */
  analysis: boolean;
  /** As falas inteiras, para a checagem das citações da análise. */
  turns: TranscriptTurn[];
  transcript: string;
  tools: string[];
}

const notAnalyzed = (q: OrgQuery, callId: string, reason: AnalysisNotDoneReason, details: object, at: Date): Promise<void> =>
  recordEvent(q, callId, "analysis_not_done", { reason, ...details }, at);

/**
 * Diz o que aconteceu na ligação — o desfecho comercial, não o relato técnico — e, com a análise
 * ligada, como foi o atendimento: a nota pela régua, a temperatura e as objeções.
 *
 * Desligado de fábrica: só roda com `calls.outcome_enabled` ou `calls.analysis_enabled` ligado pelo
 * dono, porque cada ligação lida é uma chamada paga ao provedor, com a transcrição em texto. Com a
 * análise ligada, o pedido é o completo, e o desfecho é gravado junto: veio na mesma resposta, já
 * pago. Só com o desfecho ligado, o pedido é exatamente o de antes da análise. Nunca são duas
 * chamadas pagas para a mesma ligação (desenho `docs/specs/2026-11-13-analise-da-ligacao.md`).
 *
 * A leitura é do **motor do agente**: quem fala é quem lê, e a chave já está guardada. Sem motor
 * que classifique ou sem chave, o desfecho não é gravado e a próxima execução, quando a chave
 * existir, classifica. A análise que não dá para pedir vira `analysis_not_done` com o motivo.
 *
 * O custo segue o caminho do custo da voz: uma linha no extrato (`usage_ledger`) e a soma em
 * `calls.cost_cents`, uma vez por chamada ao provedor. Ligação que já atingiu o teto de custo do
 * agente não é lida. Falha do provedor e teto atingido viram `outcome_not_classified` (desfecho
 * pedido) e `analysis_not_done` (análise pedida) na linha do tempo, cada um com o motivo.
 *
 * Roda depois de `summarize_call`, que é quem enfileira. A chamada ao provedor acontece fora da
 * transação (leva até trinta segundos) e não lança: falha não devolve a tarefa à fila para pagar de novo.
 */
const routine: Routine = {
  kind: "classify_call_outcome",
  async run(task, deps) {
    if (!task.callId) throw new Error("classify_call_outcome needs a task with callId");
    const callId = task.callId;
    const engines = await loadEngines();

    const pendente = await withOrg(deps.db, task.organizationId, async (q): Promise<Pendente | null> => {
      // Desligadas de fábrica. A tarefa pode ter entrado na fila antes de alguém desligar: confere de novo.
      const settings = await q.many<{ key: string; value: unknown }>("select key, value from settings where key = any($1)", [[OUTCOME_SETTING, ANALYSIS_SETTING]]);
      const outcomeOn = outcomeEnabledOf(settings.find((row) => row.key === OUTCOME_SETTING)?.value);
      const analysisOn = analysisEnabledOf(settings.find((row) => row.key === ANALYSIS_SETTING)?.value);
      if (!outcomeOn && !analysisOn) return null;

      const call = await q.one<{ agent_id: string | null; outcome: CallOutcome | null; analyzed: boolean; cost_cents: number }>(
        "select agent_id, outcome, analyzed_at is not null or analysis is not null as analyzed, cost_cents from calls where id = $1",
        [callId],
      );
      if (!call) throw new Error(`Call ${callId} not found in this organization`);
      // Já lido: chamar o provedor de novo custaria dinheiro para escrever o mesmo.
      const outcome = outcomeOn && call.outcome === null;
      let analysis = analysisOn && !call.analyzed;
      if ((!outcome && !analysis) || call.agent_id === null) return null;

      const agent = await q.one<{ engine: string; cost_ceiling_cents: number }>("select engine, cost_ceiling_cents from agents where id = $1", [call.agent_id]);
      if (!agent) return null;
      const now = deps.clock.now();

      const events = await q.many<{ kind: string; text: string | null; name: string | null }>(
        `select kind, payload->>'text' as text, payload->>'name' as name from call_events
          where call_id = $1 and kind in ('transcript_user', 'transcript_agent', 'tool_called') order by id`,
        [callId],
      );
      const turns = events.flatMap((event): TranscriptTurn[] =>
        event.kind !== "tool_called" && event.text ? [{ speaker: event.kind === "transcript_user" ? "user" : "agent", text: event.text }] : [],
      );
      const falas = turns.map((turn) => `${turn.speaker === "user" ? "Cliente" : "Agente"}: ${turn.text}`);
      const toolNames = [...new Set(events.flatMap((event) => (event.kind === "tool_called" && event.name ? [event.name] : [])))];
      // Sem fala nenhuma não há o que ler: melhor não gastar uma chamada para responder "unknown".
      if (falas.length === 0) {
        if (analysis) await notAnalyzed(q, callId, "no_speech", { engine: agent.engine }, now);
        return null;
      }

      // O motor simulado não lê conversa e não declara análise: o desfecho segue como sempre.
      const engine = engines.get(agent.engine);
      if (analysis && !(engine?.classifyOutcome && engine.analyzes)) {
        await notAnalyzed(q, callId, "engine_cannot_analyze", { engine: agent.engine }, now);
        analysis = false;
        if (!outcome) return null;
      }

      const chave = await q.one<{ value: unknown }>("select value from settings where key = $1", [engineKeySetting(agent.engine)]);
      if (typeof chave?.value !== "string") {
        if (analysis) await notAnalyzed(q, callId, "no_key", { engine: agent.engine }, now);
        return null;
      }

      // O mesmo teto da voz: zero é "sem teto". Chegou nele, não gasta mais nada nesta ligação.
      // ponytail: confere o que já foi gasto, não o que a leitura vai custar; ela pode passar do
      // teto pelo próprio valor (centavos). Estimar antes pede um limite de tokens de saída.
      if (agent.cost_ceiling_cents > 0 && call.cost_cents >= agent.cost_ceiling_cents) {
        const ceiling = { engine: agent.engine, costCents: call.cost_cents, ceilingCents: agent.cost_ceiling_cents };
        if (outcome) await recordEvent(q, callId, "outcome_not_classified", { reason: "cost_ceiling", ...ceiling }, now);
        if (analysis) await notAnalyzed(q, callId, "cost_ceiling", ceiling, now);
        return null;
      }

      return {
        engineId: agent.engine,
        // Decifrar fora daqui mantém o texto cifrado o tempo todo no banco; o claro vive só na memória.
        stored: chave.value,
        outcome,
        analysis,
        turns,
        // O pedido completo leva a conversa inteira, e o motor corta acima do limite dele. O só de
        // desfecho leva o fim, como sempre.
        transcript: analysis ? falas.join("\n") : falas.join("\n").slice(-TRANSCRIPT_LIMIT),
        tools: toolNames,
      };
    });
    if (!pendente) return;

    const engine = engines.get(pendente.engineId);
    if (!engine?.classifyOutcome) return;

    const result: ClassifyResult = await engine.classifyOutcome(
      decryptSecret(pendente.stored, deps.secretKey),
      { transcript: pendente.transcript, tools: pendente.tools, ...(pendente.analysis ? { analyze: true } : {}) },
      { fetch: deps.fetch },
    );

    const now = deps.clock.now();
    await withOrg(deps.db, task.organizationId, async (q) => {
      const { usage, costCents } = result;
      const inputTokens = (usage.inputTokens ?? 0) + (usage.textInputTokens ?? 0) + (usage.cachedInputTokens ?? 0);
      const outputTokens = (usage.outputTokens ?? 0) + (usage.textOutputTokens ?? 0);
      // O que o provedor cobrou entra no extrato e no custo da chamada, como o consumo da voz. Uma vez:
      // o desfecho e a análise vieram na mesma resposta.
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

      // Sem a chave e sem o corpo do provedor: o motivo no vocabulário fechado e o status bastam.
      // Dois eventos quando as duas funções estão ligadas: cada um diz o que não aconteceu.
      const failed = async (reason: ClassifyFailure, status: number | null): Promise<void> => {
        const details = { engine: pendente.engineId, model: result.model, status, costCents };
        if (pendente.outcome) await recordEvent(q, callId, "outcome_not_classified", { reason, ...details }, now);
        if (pendente.analysis) await notAnalyzed(q, callId, reason, details, now);
      };
      if (!result.ok) return failed(result.failure, result.status);

      // A análise passa pela checagem contra as falas e pelo schema de gravação antes de qualquer
      // escrita: fora da forma, ela quebraria o expurgo da organização inteira. Como veio na mesma
      // resposta do desfecho, nada é gravado.
      let analysis = null;
      if (pendente.analysis) {
        if (!result.analysis) return failed("unexpected_response", 200);
        const checked = callAnalysisSchema.safeParse(verifyAgainstTranscript({ rubricVersion: RUBRIC_VERSION, model: result.model, ...result.analysis }, pendente.turns));
        if (!checked.success) return failed("unexpected_response", 200);
        analysis = checked.data;
      }

      const decidido = settleOutcome(result.guess);
      // Se o titular pediu o apagamento enquanto o provedor respondia, o desfecho (que não é fala)
      // fica e a citação não. O `update` trava a linha e relê `erased_at` depois de o apagamento confirmar.
      await q.exec(
        "update calls set outcome = $2, outcome_confidence = $3, outcome_evidence = case when erased_at is null then $4 end, outcome_classified_at = $5 where id = $1 and outcome is null",
        [callId, decidido.outcome, decidido.confidence, decidido.evidence, now],
      );
      if (!analysis) return;

      // A nota sai só da régua, nunca de um número do modelo. Numa chamada apagada a pedido do
      // titular, a nota (soma dos status, que não é fala) fica e o texto não: a forma expurgada não
      // teria de onde sair depois. Mesmo `update`, mesma releitura de `erased_at` do desfecho.
      const score = scoreOf(analysis.criteria);
      const written = await q.exec(
        "update calls set analysis = case when erased_at is null then $2::jsonb end, analysis_score = $3, analyzed_at = $4 where id = $1 and analysis is null and analyzed_at is null",
        [callId, JSON.stringify(analysis), score, now],
      );
      if (written === 0) return;
      await recordEvent(q, callId, "call_analyzed", { score, rubricVersion: analysis.rubricVersion, model: result.model, costCents, droppedObjections: analysis.droppedObjections }, now);
    });
  },
};

export default routine;
