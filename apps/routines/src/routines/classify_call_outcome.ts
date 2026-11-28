import { RUBRIC_VERSION, agentAnalysisBrain, callAnalysisSchema, decryptSecret, recordEvent, scoreOf, SPEND_CAP_REACHED, spendCapReached, verifyAgainstTranscript, withOrg, type OrgQuery, type TranscriptTurn } from "@deskvoice/core";
import {
  ANALYSIS_SCHEMA,
  ANALYSIS_SCHEMA_GOOGLE,
  ANALYSIS_SETTING,
  MICROCENTS_PER_CENT,
  OUTCOME_GUESS_SCHEMA,
  OUTCOME_GUESS_SCHEMA_GOOGLE,
  OUTCOME_SETTING,
  ANALYSIS_TIMEOUT_MS,
  analysisEnabledOf,
  analysisPrompt,
  classifyDestinationOf,
  engineClassifyTargetSetting,
  estimateCostMicrocents,
  loadBrains,
  loadEngines,
  outcomeEnabledOf,
  outcomePrompt,
  readAnalysisGuess,
  readOutcomeGuess,
  settleOutcome,
  type AnalysisGuess,
  type Brain,
  type BrainPrice,
  type CallOutcome,
  type ClassifyDestinationRefusal,
  type ClassifyFailure,
  type ClassifyResult,
  type ClassifyTarget,
  type OutcomeGuess,
  type Usage,
} from "@deskvoice/voice-engine";
import { safeFetch, UnsafeDestinationError } from "@deskvoice/tools";
import { z } from "zod";
import type { Routine, RoutineDeps } from "../types";
import { enqueueCallReports } from "./deliver_webhook";

/** Mesmo nome que o painel usa: a chave do motor, cifrada. */
const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;

/** Uma ligação longa não precisa inteira: o desfecho mora no fim da conversa. */
const TRANSCRIPT_LIMIT = 6000;

/**
 * Os motivos do cérebro escolhido para ler a ligação (`calls.analysis_brain`). Cada um tem frase na
 * linha do tempo, nas três línguas, nos dois eventos (`outcome_not_classified` e `analysis_not_done`).
 * - `brain_unavailable`: o cérebro não foi descoberto, ou o modelo saiu da lista guardada dele.
 * - `brain_no_key`: o cérebro escolhido não tem chave. O `no_key` fala do motor de voz e mentiria aqui.
 * - `brain_unmeasured_without_ceiling`: modelo sem preço conhecido e agente sem teto de custo.
 */
type BrainRefusal = "brain_unavailable" | "brain_no_key" | "brain_unmeasured_without_ceiling";

/** Por que a análise não foi pedida, ou não foi gravada. */
type AnalysisNotDoneReason = "no_speech" | "no_key" | "engine_cannot_analyze" | "cost_ceiling" | typeof SPEND_CAP_REACHED | ClassifyFailure | ClassifyDestinationRefusal | BrainRefusal;

/** Mesmos nomes que o painel usa (`apps/panel/src/server/settings.ts` e `brains.ts`). */
const ANALYSIS_BRAIN_SETTING = "calls.analysis_brain";
const brainKeySetting = (brainId: string): string => `brain.${brainId}.api_key`;
const brainModelsSetting = (brainId: string): string => `brain.${brainId}.models`;

/** A escolha gravada pelo painel. Fora da forma (banco editado à mão) é cérebro indisponível, nunca o motor. */
const analysisBrainChoice = z.object({ brain: z.string().min(1), model: z.string().min(1) });

// A lista guardada do cérebro, lida de novo aqui: o preço que vale é o da lista **no momento da
// leitura**. Só o que a rotina usa; o painel valida a forma inteira ao gravar.
const cents = z.number().finite().nonnegative();
const storedBrainModels = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      price: z
        .object({
          centsPerMillionInputTokens: cents,
          centsPerMillionOutputTokens: cents,
          centsPerMillionCachedInputTokens: cents.optional(),
          source: z.string(),
          checkedOn: z.string(),
        })
        .optional(),
    }),
  ),
});

// O prazo do pedido só de desfecho; o completo, com a análise, tem o dele (`ANALYSIS_TIMEOUT_MS`).
const OUTCOME_TIMEOUT_MS = 10_000;
// A resposta da análise passa dos 16 KB que a guarda aceita por padrão para um conector.
const CLASSIFY_MAX_BYTES = 1024 * 1024;
// Status que a especificação proíbe de ter corpo num `Response`.
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/**
 * O `fetch` do endpoint configurado: o pedido passa pela guarda de rede dos conectores (`safeFetch`),
 * com o DNS resolvido e cada redirecionamento conferido. `refused` marca que foi a guarda que recusou,
 * para a linha do tempo dizer isso em vez de "o provedor não respondeu".
 */
function guardedFetch(deps: RoutineDeps, timeoutMs: number): { fetch: typeof fetch; refused: () => boolean } {
  let refused = false;
  const guarded: typeof fetch = async (input, init) => {
    try {
      const response = await safeFetch(
        String(input),
        { method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()), body: typeof init?.body === "string" ? init.body : undefined },
        { fetch: deps.fetch, lookup: deps.lookup, timeoutMs, maxBytes: CLASSIFY_MAX_BYTES },
      );
      return new Response(NULL_BODY_STATUS.has(response.status) ? null : response.body, { status: response.status });
    } catch (error) {
      if (error instanceof UnsafeDestinationError) refused = true;
      throw error;
    }
  };
  return { fetch: guarded, refused: () => refused };
}

/** O cérebro escolhido para ler esta ligação, já conferido: descoberto, com o modelo na lista e com chave. */
interface PorCerebro {
  brain: Brain;
  model: string;
  /** De quem é a escolha: do agente (`agents.analysis_brain`) ou da organização (`calls.analysis_brain`). */
  choiceFrom: "agent" | "organization";
  /** O preço da lista guardada no momento da leitura. Ausente é "não conhecido", nunca zero. */
  price?: BrainPrice;
}

interface Pendente {
  engineId: string;
  /** Com `calls.analysis_brain` gravado, quem lê é o cérebro, e nunca o motor. */
  cerebro?: PorCerebro;
  /** A chave que vai no pedido, cifrada: a do endpoint configurado, ou a do motor sem endpoint. */
  stored: string;
  /** Endpoint e modelo da classificação gravados pelo dono; vazio é o padrão do motor. */
  target: ClassifyTarget;
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

/** A leitura do texto JSON que o cérebro devolveu, a mesma de `readClassifyText` nos motores. */
function readBrainText(text: string, analyze: boolean): { guess: OutcomeGuess; analysis?: AnalysisGuess } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (analyze) return readAnalysisGuess(raw);
  const guess = readOutcomeGuess(raw);
  return guess ? { guess } : null;
}

/**
 * O custo de uma leitura do cérebro. Medido só com preço conhecido **e** consumo declarado: um
 * resultado sem `usage`, ou com `usage` sem `inputTokens` (a DeepSeek sem preço, o Haiku 5.5 com
 * preço por faixa, a escrita em cache da Anthropic), é custo desconhecido, nunca zero. Um erro HTTP
 * que não é 200 não foi cobrado: o zero dele é medido.
 */
function brainCost(result: { ok: boolean; status?: number | null; usage: Usage }, price: BrainPrice | undefined): { costMicrocents: number; costMeasured: boolean } {
  const charged = result.ok || result.status === 200 || result.status === null;
  const costMeasured = !charged || (price !== undefined && typeof result.usage.inputTokens === "number");
  return { costMicrocents: costMeasured && price !== undefined ? estimateCostMicrocents(price, result.usage) : 0, costMeasured };
}

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
 * O destino da classificação não é fixo: `engine.<id>.classify_target` leva o pedido a um
 * provedor compatível com OpenAI (DeepSeek, Qwen, OpenRouter, Groq), com a chave própria desse
 * endpoint, nunca a do motor, e pela guarda de rede dos conectores. Endpoint sem a chave dele, ou
 * que não passa na guarda, não recebe nada, e a linha do tempo diz por quê. Sem endpoint, o pedido
 * é o de sempre, no endereço oficial do motor, com a chave do motor.
 *
 * O custo segue o caminho do custo da voz: uma linha no extrato (`usage_ledger`) e a soma em
 * `calls.cost_cents`, uma vez por chamada ao provedor. A linha guarda o micro-centavo
 * (`cost_microcents`), porque ler uma ligação custa cerca de 0,03 centavo e o centavo inteiro por
 * leitura seria trinta vezes o valor de tabela; `calls.cost_cents` é o extrato somado e arredondado
 * uma vez só. Com endpoint e modelo configurados, o preço do modelo não é conhecido pelo projeto: o
 * consumo vai ao extrato e o custo fica zero, em vez de um número errado. Sem endpoint, quem cobra é
 * o provedor do motor e só o modelo de tabela é pedido — modelo fora dela que esteja gravado cai no
 * de tabela, porque cobrar sem medir não é custo, é dívida escondida. Ligação que já atingiu o teto
 * do agente não é lida — o teto continua sendo comparado com o mesmo `calls.cost_cents`, na mesma
 * unidade de antes. Falha do provedor e teto
 * atingido viram `outcome_not_classified` (desfecho pedido) e `analysis_not_done` (análise pedida)
 * na linha do tempo, cada um com o motivo.
 *
 * Cada agente pode ter a escolha dele (`agents.analysis_brain`, desenho da R4 fatia 5): nula segue a
 * da organização; `{ kind: "engine" }` é o motor do agente; `{ kind: "brain" }`, um cérebro e um
 * modelo. A do agente vale sozinha: falhando, não cai na da organização nem no motor.
 *
 * Com `calls.analysis_brain` gravado (`{ brain, model }`), quem lê é o cérebro escolhido, para o
 * desfecho e para a análise, na frente do motor e do `classify_target`, com a chave do cérebro e o
 * preço da lista guardada dele. Sem fallback para o motor: cérebro indisponível ou sem chave não lê,
 * e a linha do tempo diz por quê. Modelo sem preço só lê ligação de agente com teto, e a linha do
 * extrato fica `cost_measured = false` (desenho `docs/specs/2026-11-16-catalogo-de-cerebros.md`, 3.5).
 *
 * Roda depois de `summarize_call`, que é quem enfileira. A chamada ao provedor acontece fora da
 * transação (leva até trinta segundos) e não lança: falha não devolve a tarefa à fila para pagar de novo.
 */
const classify: Routine = {
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

      // `follows_org` vem do banco: o `null` do JSON gravado à mão chega aqui como `null` também, e é
      // escolha fora da forma, não "segue a organização".
      const agent = await q.one<{ engine: string; cost_ceiling_cents: number; analysis_brain: unknown; follows_org: boolean }>(
        "select engine, cost_ceiling_cents, analysis_brain, analysis_brain is null as follows_org from agents where id = $1",
        [call.agent_id],
      );
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

      // O teto do mês da organização, pelo mesmo caminho das portas da ligação (`spendCapReached`):
      // no teto, nem o cérebro nem o motor recebem pedido, e a linha do tempo diz por quê.
      const cap = await spendCapReached(q, now);
      if (cap.reached) {
        const details = { engine: agent.engine, capCents: cap.capCents };
        if (outcome) await recordEvent(q, callId, "outcome_not_classified", { reason: SPEND_CAP_REACHED, ...details }, now);
        if (analysis) await notAnalyzed(q, callId, SPEND_CAP_REACHED, details, now);
        return null;
      }

      // O cérebro escolhido passa na frente do motor e do `classify_target`, para o desfecho e para a
      // análise (a mesma chamada paga). A escolha que vale é resolvida uma vez: a do agente
      // (`agents.analysis_brain`), e, nula, a da organização (`calls.analysis_brain`). Sem fallback:
      // cérebro que não dá para usar não lê a ligação, e a linha do tempo diz por quê. Cair na escolha
      // da organização ou no motor pagaria um provedor que o dono deixou de escolher. O agente com
      // `{ kind: "engine" }` lê pelo motor mesmo com cérebro na organização. Nada escolhido, tudo
      // segue como antes, linha por linha.
      let escolha: { choiceFrom: "agent" | "organization"; value: unknown } | null = null;
      if (!agent.follows_org) {
        const doAgente = agentAnalysisBrain.safeParse(agent.analysis_brain).data;
        // Fora da forma (gravada à mão) é cérebro indisponível, nunca a organização nem o motor.
        if (doAgente?.kind !== "engine") escolha = { choiceFrom: "agent", value: doAgente ?? null };
      } else {
        const daOrganizacao = await q.one<{ value: unknown }>("select value from settings where key = $1", [ANALYSIS_BRAIN_SETTING]);
        if (daOrganizacao) escolha = { choiceFrom: "organization", value: daOrganizacao.value };
      }
      if (escolha) {
        const choice = analysisBrainChoice.safeParse(escolha.value).data;
        const details = { brain: choice?.brain ?? null, model: choice?.model ?? null, choiceFrom: escolha.choiceFrom };
        const refuse = async (reason: BrainRefusal | "cost_ceiling", extra: object = {}): Promise<null> => {
          if (outcome) await recordEvent(q, callId, "outcome_not_classified", { reason, ...details, ...extra }, now);
          if (analysis) await notAnalyzed(q, callId, reason, { ...details, ...extra }, now);
          return null;
        };
        if (agent.cost_ceiling_cents > 0 && call.cost_cents >= agent.cost_ceiling_cents) return refuse("cost_ceiling", { costCents: call.cost_cents, ceilingCents: agent.cost_ceiling_cents });
        const brain = choice ? (await loadBrains()).get(choice.brain) : undefined;
        const lista = brain ? await q.one<{ value: unknown }>("select value from settings where key = $1", [brainModelsSetting(brain.id)]) : null;
        const listed = choice ? storedBrainModels.safeParse(lista?.value).data?.models.find((model) => model.id === choice.model) : undefined;
        if (!brain || !choice || !listed) return refuse("brain_unavailable");
        const chave = await q.one<{ value: unknown }>("select value from settings where key = $1", [brainKeySetting(brain.id)]);
        if (typeof chave?.value !== "string") return refuse("brain_no_key");
        // Sem preço, o gasto não é medido: só lê ligação de agente com teto (padrão A do pedido 1).
        if (listed.price === undefined && agent.cost_ceiling_cents <= 0) return refuse("brain_unmeasured_without_ceiling");
        return {
          engineId: agent.engine,
          cerebro: { brain, model: choice.model, choiceFrom: escolha.choiceFrom, ...(listed.price !== undefined && { price: listed.price }) },
          stored: chave.value,
          target: {},
          outcome,
          analysis,
          turns,
          transcript: analysis ? falas.join("\n") : falas.join("\n").slice(-TRANSCRIPT_LIMIT),
          tools: toolNames,
        };
      }

      // O motor simulado não lê conversa e não declara análise: o desfecho segue como sempre.
      const engine = engines.get(agent.engine);
      if (analysis && !(engine?.classifyOutcome && engine.analyzes)) {
        await notAnalyzed(q, callId, "engine_cannot_analyze", { engine: agent.engine }, now);
        analysis = false;
        if (!outcome) return null;
      }

      // O destino da classificação, se o dono configurou um (só o motor que declara aceita). Com
      // endpoint, a chave é a dele; sem, a do motor. O painel valida ao gravar; aqui é a segunda
      // leitura, para o banco editado à mão não virar pedido para um endereço interno.
      const alvo = engine?.classifyTarget
        ? await q.one<{ value: unknown }>("select value from settings where key = $1", [engineClassifyTargetSetting(agent.engine)])
        : null;
      const destino = classifyDestinationOf(alvo?.value);
      if (!destino.ok) {
        const details = { engine: agent.engine };
        if (outcome) await recordEvent(q, callId, "outcome_not_classified", { reason: destino.reason, ...details }, now);
        if (analysis) await notAnalyzed(q, callId, destino.reason, details, now);
        return null;
      }
      const chave = destino.endpointKey !== undefined ? { value: destino.endpointKey } : await q.one<{ value: unknown }>("select value from settings where key = $1", [engineKeySetting(agent.engine)]);
      if (typeof chave?.value !== "string") {
        if (analysis) await notAnalyzed(q, callId, "no_key", { engine: agent.engine }, now);
        return null;
      }
      const target = destino.target;

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
        target,
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

    let result: ClassifyResult;
    let guarded: ReturnType<typeof guardedFetch> | undefined;
    // Só no caminho do cérebro: o que vai a mais no extrato e nos eventos.
    let porCerebro: { brain: string; costMeasured: boolean; choiceFrom: "agent" | "organization" } | undefined;
    if (pendente.cerebro) {
      const { brain, model, price, choiceFrom } = pendente.cerebro;
      const input = { transcript: pendente.transcript, tools: pendente.tools };
      // O mesmo pedido e os mesmos esquemas do motor; o cérebro só troca o transporte.
      const answer = await brain.completeJson(
        decryptSecret(pendente.stored, deps.secretKey),
        {
          model,
          prompt: pendente.analysis ? analysisPrompt(input) : outcomePrompt(input),
          schema: pendente.analysis
            ? { name: "analise", strict: ANALYSIS_SCHEMA, google: ANALYSIS_SCHEMA_GOOGLE }
            : { name: "desfecho", strict: OUTCOME_GUESS_SCHEMA, google: OUTCOME_GUESS_SCHEMA_GOOGLE },
          timeoutMs: pendente.analysis ? ANALYSIS_TIMEOUT_MS : OUTCOME_TIMEOUT_MS,
        },
        { fetch: deps.fetch },
      );
      const reading = answer.ok ? readBrainText(answer.text, pendente.analysis) : null;
      const cost = brainCost(answer, price);
      porCerebro = { brain: brain.id, costMeasured: cost.costMeasured, choiceFrom };
      const common = { model: answer.model, usage: answer.usage, costMicrocents: cost.costMicrocents, costCents: Math.round(cost.costMicrocents / MICROCENTS_PER_CENT) };
      result = !answer.ok
        ? { ...common, ok: false, failure: answer.failure, status: answer.status }
        : reading === null
          ? { ...common, ok: false, failure: "unexpected_response", status: 200 }
          : { ...common, ok: true, ...reading };
    } else {
      const engine = engines.get(pendente.engineId);
      if (!engine?.classifyOutcome) return;

      // Endpoint configurado vai pela guarda de rede; o endereço oficial do motor, como antes.
      guarded = pendente.target.baseUrl !== undefined ? guardedFetch(deps, pendente.analysis ? ANALYSIS_TIMEOUT_MS : OUTCOME_TIMEOUT_MS) : undefined;
      result = await engine.classifyOutcome(
        decryptSecret(pendente.stored, deps.secretKey),
        { transcript: pendente.transcript, tools: pendente.tools, ...(pendente.analysis ? { analyze: true } : {}) },
        { fetch: guarded?.fetch ?? deps.fetch, ...pendente.target },
      );
    }

    const now = deps.clock.now();
    await withOrg(deps.db, task.organizationId, async (q) => {
      const { usage, costMicrocents } = result;
      // O centavo desta leitura é o arredondamento do micro-centavo, a mesma conta que a linha do
      // extrato leva: 0,034 centavo fica 0, e 8,1 ficam 8. O exato vive no extrato, não aqui.
      const costCents = Math.round(costMicrocents / MICROCENTS_PER_CENT);
      const inputTokens = (usage.inputTokens ?? 0) + (usage.textInputTokens ?? 0) + (usage.cachedInputTokens ?? 0);
      const outputTokens = (usage.outputTokens ?? 0) + (usage.textOutputTokens ?? 0);
      // O que o provedor cobrou entra no extrato e no custo da chamada, como o consumo da voz. Uma vez:
      // o desfecho e a análise vieram na mesma resposta. O extrato guarda o micro-centavo, que é a
      // unidade em que uma leitura de 0,03 centavo existe; o `cost_cents` da linha é essa medida
      // arredondada, e o da chamada é o extrato somado e arredondado **uma vez só** — cobrar um
      // centavo por leitura daria trinta vezes o valor de tabela.
      // No cérebro, a linha leva o modelo cobrado e se o custo foi medido. Custo desconhecido entra
      // mesmo sem token declarado: é a linha que diz "não medido", em vez de um zero que parece grátis.
      if (porCerebro && (inputTokens > 0 || outputTokens > 0 || costMicrocents > 0 || !porCerebro.costMeasured)) {
        await q.exec(
          "insert into usage_ledger (organization_id, call_id, engine, model, cost_measured, input_tokens, output_tokens, cost_cents, cost_microcents, at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [q.organizationId, callId, `brain:${porCerebro.brain}`, result.model, porCerebro.costMeasured, inputTokens, outputTokens, costCents, costMicrocents, now],
        );
        await q.exec(
          "update calls set cost_cents = round((select coalesce(sum(cost_microcents), 0) from usage_ledger where call_id = $1)::numeric / 1000000) where id = $1",
          [callId],
        );
      } else if (!porCerebro && (inputTokens > 0 || outputTokens > 0 || costMicrocents > 0)) {
        await q.exec(
          "insert into usage_ledger (organization_id, call_id, engine, input_tokens, output_tokens, cost_cents, cost_microcents, at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
          [q.organizationId, callId, pendente.engineId, inputTokens, outputTokens, Math.round(costCents), costMicrocents, now],
        );
        await q.exec(
          "update calls set cost_cents = round((select coalesce(sum(cost_microcents), 0) from usage_ledger where call_id = $1)::numeric / 1000000) where id = $1",
          [callId],
        );
      }

      // Sem a chave e sem o corpo do provedor: o motivo no vocabulário fechado e o status bastam.
      // Dois eventos quando as duas funções estão ligadas: cada um diz o que não aconteceu.
      const failed = async (reason: ClassifyFailure | ClassifyDestinationRefusal, status: number | null): Promise<void> => {
        // `endpoint` diz à tela que a chave do pedido era a do endpoint configurado, não a do motor.
        const details = porCerebro
          ? { brain: porCerebro.brain, model: result.model, status, costCents, costMeasured: porCerebro.costMeasured, choiceFrom: porCerebro.choiceFrom }
          : { engine: pendente.engineId, model: result.model, status, costCents, ...(pendente.target.baseUrl !== undefined && { endpoint: true }) };
        if (pendente.outcome) await recordEvent(q, callId, "outcome_not_classified", { reason, ...details }, now);
        if (pendente.analysis) await notAnalyzed(q, callId, reason, details, now);
      };
      if (!result.ok) return failed(guarded?.refused() ? "endpoint_refused" : result.failure, result.status);

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
      await recordEvent(
        q,
        callId,
        "call_analyzed",
        {
          score,
          rubricVersion: analysis.rubricVersion,
          model: result.model,
          costCents,
          droppedObjections: analysis.droppedObjections,
          ...(porCerebro && { brain: porCerebro.brain, costMeasured: porCerebro.costMeasured, choiceFrom: porCerebro.choiceFrom }),
        },
        now,
      );
    });
  },
};

/**
 * O relatório da ligação sai depois da leitura, qualquer que tenha sido o fim dela (lida, não lida,
 * recusada pelo teto): é o fim do trabalho sobre a ligação. Sem webhook que peça, nada entra na fila.
 */
const routine: Routine = {
  kind: classify.kind,
  async run(task, deps) {
    await classify.run(task, deps);
    const callId = task.callId as string;
    await withOrg(deps.db, task.organizationId, (q) => enqueueCallReports(q, callId, deps.clock.now()));
  },
};

export default routine;
