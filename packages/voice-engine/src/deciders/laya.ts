/**
 * Laya (Convai Innovations) como modelo de decisão: o serviço `laya` do Compose (`deploy/laya/`),
 * no perfil `laya`, só na rede interna. Um POST, sem SDK e sem chave (desenho R12, fatia 8a).
 *
 * O pedido é `POST http://laya:8000/v1/decide` com `{ state, questions }`, as perguntas no formato
 * que o Laya lê (o mesmo do Jev: `type`, `instructions` e, conforme o tipo, `criteria`). A resposta é
 * `{ model, answers }`, com as respostas no formato do Jev; o servidor tira os campos a mais do Laya.
 *
 * Nada sai da VPS: o serviço roda nesta máquina, com os pesos dentro da imagem. Sem custo por
 * pedido (o custo é memória e CPU, e o teto de CPU do serviço o limita). Serviço fora do ar, ainda
 * carregando ou ocupado (503) é `unreachable`, e a regra de "ninguém espera o filtro" vale igual: a
 * chamada segue sem filtro.
 *
 * O endereço é fixo, e não vem de configuração: o texto de quem ligou só vai para o serviço da
 * própria instalação. `baseUrl` existe para os testes.
 *
 * O acerto medido na bancada (rodada 3, 15/11/2026) é perto do acaso nas três perguntas. Por isso a
 * tela ainda não o oferece (filtro em `offeredModels`, no painel), até a fatia 9 pôr a frase sobre o
 * acerto ao lado da opção.
 */
import { z } from "zod";
import type { ClassifyFailure, DecideInput, DecideResult, DecisionAnswer, DecisionModel, DecisionQuestion, EnginePricing } from "../types";

const BASE_URL = "http://laya:8000";
const DEFAULT_TIMEOUT_MS = 10_000;

export const LAYA_PRICING: EnginePricing = {
  checkedOn: "2026-11-18",
  source: "Laya: roda nesta instalação, no serviço `laya` do Compose. Sem custo por pedido; o custo é memória e CPU",
};

const scheduleTimeout = (fn: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(fn, delayMs);
  return () => clearTimeout(timer);
};

const probability = z.number().min(0).max(1);
const answerSchema = z.union([
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: probability.optional(), probabilities: z.record(z.string(), probability).optional() }),
  z.object({ type: z.literal("score"), score: z.number(), confidence: probability.optional(), probabilities: z.record(z.string(), probability).optional() }),
]);
const responseSchema = z.object({ model: z.string(), answers: z.record(z.string(), answerSchema) });

/** A pergunta no formato que o Laya lê. */
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
  return { kind: "score", score: answer.score, probabilities, confidence: answer.confidence ?? 0 };
}

/** 503 é o serviço carregando o modelo ou sem vaga: para quem usa, o mesmo que fora do ar. */
function failureOf(status: number): ClassifyFailure {
  if (status >= 500) return "unreachable";
  return "unexpected_response";
}

const laya: DecisionModel = {
  id: "laya",
  label: "Laya (neste servidor)",
  provider: "convai",
  processingLocation: { kind: "this-server" },
  keyless: true,
  pricing: LAYA_PRICING,

  async decide(_apiKey: string, input: DecideInput, options = {}): Promise<DecideResult> {
    const started = performance.now();
    const controller = new AbortController();
    let late = false;
    const cancel = (options.schedule ?? scheduleTimeout)(() => {
      late = true;
      controller.abort();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const done = (rest: { ok: true; answers: Record<string, DecisionAnswer> } | { ok: false; failure: ClassifyFailure | "late"; status: number | null }, model = "laya"): DecideResult => ({
      model,
      usage: {},
      costCents: 0,
      costMicrocents: 0,
      latencyMs: Math.round(performance.now() - started),
      ...rest,
    });
    try {
      const questions = Object.fromEntries(Object.entries(input.questions).map(([id, question]) => [id, wireQuestion(question)]));
      let response: Response;
      let text: string;
      try {
        response = await (options.fetch ?? fetch)(`${options.baseUrl ?? BASE_URL}/v1/decide`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state: input.state, questions }),
          signal: controller.signal,
        });
        text = await response.text();
      } catch {
        return done({ ok: false, failure: late ? "late" : "unreachable", status: null });
      }
      if (late) return done({ ok: false, failure: "late", status: response.status });
      if (!response.ok) return done({ ok: false, failure: failureOf(response.status), status: response.status });
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return done({ ok: false, failure: "unexpected_response", status: response.status });
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) return done({ ok: false, failure: "unexpected_response", status: response.status });
      const answers: Record<string, DecisionAnswer> = {};
      for (const [id, question] of Object.entries(input.questions)) {
        const answer = parsed.data.answers[id];
        if (answer === undefined || answer.type !== question.kind) return done({ ok: false, failure: "unexpected_response", status: response.status }, parsed.data.model);
        answers[id] = ourAnswer(answer);
      }
      return done({ ok: true, answers }, parsed.data.model);
    } finally {
      cancel();
    }
  },
};

export default laya;
