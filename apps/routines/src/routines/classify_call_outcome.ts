import { decryptSecret, withOrg } from "@deskvoice/core";
import { loadEngines, settleOutcome, type CallOutcome, type OutcomeGuess } from "@deskvoice/voice-engine";
import type { Routine } from "../types";

/** Mesmo nome que o painel usa: a chave do motor, cifrada. */
const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;
/** Sobrepõe o modelo de classificação sem PR — se o padrão do motor mudar de nome, o operador troca. */
const classifyModelSetting = (engineId: string): string => `engine.${engineId}.classify_model`;

/** Uma ligação longa não precisa inteira: o desfecho mora no fim da conversa. */
const TRANSCRIPT_LIMIT = 6000;

interface Pendente {
  engineId: string;
  stored: string;
  model: string | null;
  transcript: string;
  tools: string[];
}

/**
 * Diz o que aconteceu na ligação — o desfecho comercial, não o relato técnico.
 *
 * A classificação é do **motor do agente**: quem fala é quem lê, e a chave já está guardada. Sem
 * motor que classifique (o simulado) ou sem chave, nada é gravado: a ligação fica sem desfecho e a
 * próxima execução, quando a chave existir, classifica. Gravar `unknown` ali seria dizer que a
 * conversa não sustenta nada quando a verdade é que ninguém leu.
 *
 * Roda depois de `summarize_call`, que é quem enfileira. A chamada ao provedor acontece fora da
 * transação (leva até dez segundos) e não lança: provedor fora do ar custa uma ligação sem
 * desfecho, nunca uma tarefa que volta para a fila três vezes.
 */
const routine: Routine = {
  kind: "classify_call_outcome",
  async run(task, deps) {
    if (!task.callId) throw new Error("classify_call_outcome needs a task with callId");
    const callId = task.callId;

    const pendente = await withOrg(deps.db, task.organizationId, async (q): Promise<Pendente | null> => {
      const call = await q.one<{ agent_id: string | null; outcome: CallOutcome | null }>("select agent_id, outcome from calls where id = $1", [callId]);
      if (!call) throw new Error(`Call ${callId} not found in this organization`);
      // Já classificado: chamar o provedor de novo custaria dinheiro para escrever o mesmo.
      if (call.outcome !== null || call.agent_id === null) return null;

      const agent = await q.one<{ engine: string }>("select engine from agents where id = $1", [call.agent_id]);
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
      const modelo = await q.one<{ value: unknown }>("select value from settings where key = $1", [classifyModelSetting(agent.engine)]);

      return {
        engineId: agent.engine,
        // Decifrar aqui dentro mantém o texto cifrado o tempo todo no banco; o claro vive só na memória.
        stored: chave.value,
        model: typeof modelo?.value === "string" ? modelo.value : null,
        transcript: falas.join("\n").slice(-TRANSCRIPT_LIMIT),
        tools: toolNames,
      };
    });
    if (!pendente) return;

    const engines = await loadEngines();
    const engine = engines.get(pendente.engineId);
    if (!engine?.classifyOutcome) return;

    let guess: OutcomeGuess;
    try {
      guess = await engine.classifyOutcome(
        decryptSecret(pendente.stored, deps.secretKey),
        { transcript: pendente.transcript, tools: pendente.tools },
        { fetch: deps.fetch, ...(pendente.model ? { model: pendente.model } : {}) },
      );
    } catch {
      // O contrato diz que não lança; se um motor quebrar essa promessa, a ligação fica sem desfecho
      // em vez de a tarefa voltar para a fila.
      return;
    }

    const decidido = settleOutcome(guess);
    // `unknown` com confiança zero é o que o transporte devolve quando nada foi lido (prazo, 429,
    // 500, corpo estranho). Não é resposta: gravar aqui enterraria a ligação como "sem desfecho"
    // para sempre, quando o certo é classificar quando o provedor voltar.
    if (decidido.outcome === "unknown" && decidido.confidence === 0) return;
    await withOrg(deps.db, task.organizationId, (q) =>
      q.exec("update calls set outcome = $2, outcome_confidence = $3, outcome_evidence = $4, outcome_classified_at = now() where id = $1 and outcome is null", [
        callId,
        decidido.outcome,
        decidido.confidence,
        decidido.evidence,
      ]),
    );
  },
};

export default routine;
