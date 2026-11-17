/**
 * Jev (TypeSafe AI) como modelo de decisão: um POST, sem SDK do fornecedor.
 *
 * Fontes, conferidas em 16/11/2026 (as mesmas que a bancada conferiu em 15/11):
 * - pedido: docs.typesafe.ai/api/system-one.md e docs.typesafe.ai/primitives.md.
 *   `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`, corpo `{ model, state,
 *   questions }`; cada pergunta tem `type` (`noul`, `choice`, `score`), `instructions` e, conforme o
 *   tipo, `criteria` (as opções do `choice`, o sim e o não do `noul`, os níveis do `score`). A
 *   resposta é `{ model, answers, usage }`, com `usage.input_tokens` e `usage.output_tokens`;
 * - erros: docs.typesafe.ai/api/errors.md. 401 chave ausente ou inválida, 429 limite, 529
 *   sobrecarga; 400 e 422 pedido fora da regra;
 * - teste da chave: docs.typesafe.ai/api/list-models.md. `GET /v1/models` lista os modelos da conta,
 *   sem custo de token;
 * - preço: docs.typesafe.ai/models.md. US$ 0,042 por milhão de tokens de entrada, saída grátis. A
 *   página não diz como o texto vira token nem se um pedido que falha é cobrado; diz só que o
 *   `state` e todas as perguntas entram no limite do pedido.
 *
 * Custo desconhecido nunca é zero (desenho R12, fatia 7a): quando o pedido saiu e o consumo não
 * foi lido (o prazo venceu, a rede caiu, ou um 2xx veio fora da forma), o resultado leva uma
 * estimativa marcada (`costEstimated`). A entrada estimada é o que o pedido leva, o `state` e as
 * perguntas no formato do Jev, contado como **um token por byte** (a regra de pior caso da bancada,
 * `scripts/bancada-de-voz/filtro-na-chamada.ts`; na rodada de 16/11 o consumo real foi cerca de
 * 0,6 token por byte, então a estimativa fica acima). A saída estimada é zero, porque a saída é grátis.
 * Uma resposta de erro HTTP (fora de 2xx: 401, 429, 529, 400, 422) é recusa do pedido e fica sem
 * custo, como antes; essa escolha não está medida na página do fornecedor.
 *
 * Onde o texto é processado: a política de privacidade, https://typesafe.ai/legal/privacy-policy
 * ("Last updated Nov 19, 2025", lida em 16/11/2026 e de novo em 17/11/2026), diz em *International
 * Visitors* que o serviço é hospedado nos Estados Unidos ("The Services are hosted in the United
 * States"). Por isso `US`, com a página e a data como fonte (desenho R12, fatia 7b). Antes dessa
 * leitura era `undeclared`: nenhuma página de documentação diz o país.
 *
 * A chave nunca sai em erro, resultado ou log: o resultado é só o vocabulário fechado e o status.
 */
import { z } from "zod";
import { byStatus, checkKeyOverHttp } from "../key-check";
import { estimateCostCents, estimateCostMicrocents } from "../pricing";
import type { ClassifyFailure, DecideInput, DecideResult, DecisionAnswer, DecisionModel, DecisionQuestion, EnginePricing, KeyCheckResult, Usage } from "../types";

const BASE_URL = "https://api.typesafe.ai";
const MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 10_000;

export const JEV_PRICING: EnginePricing = {
  // US$ 0,042 por milhão de tokens de entrada = 4,2 centavos.
  centsPerMillionInputTokens: 4.2,
  centsPerMillionOutputTokens: 0,
  checkedOn: "2026-11-16",
  source: "https://docs.typesafe.ai/models.md (US$ 0,042 por milhão de tokens de entrada, saída grátis)",
};

const scheduleTimeout = (fn: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(fn, delayMs);
  return () => clearTimeout(timer);
};

const probability = z.number().min(0).max(1);
const answerSchema = z.union([
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: probability.nullable().optional(), probabilities: z.record(z.string(), probability).optional() }),
  z.object({ type: z.literal("score"), score: z.number(), confidence: probability.nullable().optional(), probabilities: z.record(z.string(), probability).optional() }),
]);
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
/** Quantos bytes UTF-8 o texto tem: a contagem da estimativa, um token por byte. */
const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** A entrada estimada de um pedido: o `state` e as perguntas, como vão no corpo, um token por byte. */
export function estimatedInputTokens(state: DecideInput["state"], questions: Record<string, unknown>): number {
  return utf8Bytes(JSON.stringify({ state, questions }));
}

const modelsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });

/** A pergunta no formato do Jev. */
function wireQuestion(question: DecisionQuestion): Record<string, unknown> {
  if (question.kind === "noul") return { type: "noul", instructions: question.instruction, ...(question.criteria && { criteria: question.criteria }) };
  if (question.kind === "choice") return { type: "choice", instructions: question.instruction, criteria: question.options };
  return { type: "score", instructions: question.instruction, criteria: question.levels };
}

/** A confiança da escolha: `confidence`, ou a probabilidade da opção escolhida, ou zero. */
function ourAnswer(answer: z.infer<typeof answerSchema>): DecisionAnswer {
  if (answer.type === "noul") return { kind: "noul", value: answer.noul };
  const probabilities = answer.probabilities ?? {};
  if (answer.type === "choice") return { kind: "choice", choice: answer.choice, probabilities, confidence: answer.confidence ?? probabilities[answer.choice] ?? 0 };
  return { kind: "score", score: answer.score, probabilities, confidence: answer.confidence ?? probabilities[String(answer.score)] ?? 0 };
}

function failureOf(status: number): ClassifyFailure {
  // 529 é a sobrecarga do Jev: para quem usa, o mesmo que o provedor fora do ar.
  if (status === 529) return "unreachable";
  const result = byStatus(status);
  return result === "accepted" || result === "not_needed" ? "unexpected_response" : result;
}

const jev: DecisionModel = {
  id: "jev",
  label: "Jev (TypeSafe)",
  provider: "typesafe",
  // Fonte: a seção "International Visitors" da política, lida em 16/11/2026 (ver o cabeçalho).
  processingLocation: { kind: "country", country: "US", source: { url: "https://typesafe.ai/legal/privacy-policy", checkedOn: "2026-11-16" } },
  pricing: JEV_PRICING,

  async decide(apiKey: string, input: DecideInput, options = {}): Promise<DecideResult> {
    const model = options.model ?? MODEL;
    const started = performance.now();
    const controller = new AbortController();
    let late = false;
    const cancel = (options.schedule ?? scheduleTimeout)(() => {
      late = true;
      controller.abort();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const questions = Object.fromEntries(Object.entries(input.questions).map(([id, question]) => [id, wireQuestion(question)]));
    const done = (usage: Usage, rest: { ok: true; answers: Record<string, DecisionAnswer> } | { ok: false; failure: ClassifyFailure | "late"; status: number | null }, answeredModel = model, costEstimated = false): DecideResult => ({
      model: answeredModel,
      usage,
      costCents: estimateCostCents(JEV_PRICING, usage),
      costMicrocents: estimateCostMicrocents(JEV_PRICING, usage),
      costEstimated,
      latencyMs: Math.round(performance.now() - started),
      ...rest,
    });
    // O pedido saiu e o consumo não foi lido: a estimativa pela entrada enviada, saída zero.
    const estimated = (rest: { ok: false; failure: ClassifyFailure | "late"; status: number | null }): DecideResult =>
      done({ inputTokens: estimatedInputTokens(input.state, questions), outputTokens: 0 }, rest, model, true);
    try {
      let response: Response;
      let text: string;
      try {
        response = await (options.fetch ?? fetch)(`${options.baseUrl ?? BASE_URL}/v1/systemone`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model, state: input.state, questions }),
          signal: controller.signal,
        });
        text = await response.text();
      } catch {
        // Sem resposta: o prazo (tarde) ou a rede. Nada foi lido; o pedido pode ter sido cobrado.
        return estimated({ ok: false, failure: late ? "late" : "unreachable", status: null });
      }
      if (late) return estimated({ ok: false, failure: "late", status: response.status });
      if (!response.ok) return done({}, { ok: false, failure: failureOf(response.status), status: response.status });
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return estimated({ ok: false, failure: "unexpected_response", status: response.status });
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) return estimated({ ok: false, failure: "unexpected_response", status: response.status });
      // Um 200 foi cobrado mesmo se faltar uma resposta: o consumo entra nos dois casos.
      const usage: Usage = { inputTokens: parsed.data.usage.input_tokens, outputTokens: parsed.data.usage.output_tokens };
      const answers: Record<string, DecisionAnswer> = {};
      for (const [id, question] of Object.entries(input.questions)) {
        const answer = parsed.data.answers[id];
        if (answer === undefined || answer.type !== question.kind) return done(usage, { ok: false, failure: "unexpected_response", status: response.status }, parsed.data.model);
        answers[id] = ourAnswer(answer);
      }
      return done(usage, { ok: true, answers }, parsed.data.model);
    } finally {
      cancel();
    }
  },

  checkKey(apiKey, options = {}) {
    return checkKeyOverHttp(
      {
        url: `${options.baseUrl ?? BASE_URL}/v1/models`,
        headers: { authorization: `Bearer ${apiKey}` },
        model: options.model ?? MODEL,
        // Aceita só quando o modelo usado está na lista da conta; uma lista sem ele é resposta fora do esperado.
        accepted: modelsSchema.refine((body) => body.models.some((each) => each.name === (options.model ?? MODEL))),
        classify: (status): KeyCheckResult | undefined => (status === 529 ? "unreachable" : undefined),
      },
      options,
    );
  },
};

export default jev;
