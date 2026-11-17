/**
 * Modelo de decisão simulado: responde sem rede, sem chave e sem custo. Serve a testes, CI e à
 * chamada simulada. O padrão responde o neutro: a fala é de quem está na ligação, o pensamento
 * terminou pela metade da certeza, e a leitura é "nenhum" (o texto fica como está).
 *
 * `createSimulatedDecider` deixa o teste escolher a resposta e a demora. A demora corre pelo
 * agendador das opções (`schedule`), como o prazo: o teste controla o tempo, e um pedido que demora
 * mais que `timeoutMs` volta `late`, como o do Jev.
 */
import { NO_TERM } from "../speech-filter";
import type { ClassifyFailure, DecideInput, DecideResult, DecisionAnswer, DecisionModel } from "../types";

export type SimulatedDecision =
  | { answers: Record<string, DecisionAnswer>; delayMs?: number }
  | { failure: ClassifyFailure; status?: number | null; delayMs?: number };

const realSchedule = (fn: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(fn, delayMs);
  return () => clearTimeout(timer);
};

/** O neutro: nenhuma marca e nenhuma sugestão. */
export function neutralAnswers(input: DecideInput): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {};
  for (const [id, question] of Object.entries(input.questions)) {
    if (question.kind === "noul") answers[id] = { kind: "noul", value: id === "finished" ? 0.5 : 1 };
    else if (question.kind === "choice") {
      const choice = NO_TERM in question.options ? NO_TERM : (Object.keys(question.options)[0] ?? NO_TERM);
      answers[id] = { kind: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 };
    } else answers[id] = { kind: "score", score: 0, probabilities: { "0": 1 }, confidence: 1 };
  }
  return answers;
}

export function createSimulatedDecider(respond: (input: DecideInput) => SimulatedDecision = (input) => ({ answers: neutralAnswers(input) })): DecisionModel {
  return {
    id: "simulated",
    label: "Simulado",
    provider: "none",
    processingLocation: { kind: "this-server" },
    keyless: true,
    pricing: { checkedOn: "2026-11-16", source: "simulado: sem custo" },
    decide(_apiKey, input, options = {}) {
      const schedule = options.schedule ?? realSchedule;
      const decision = respond(input);
      const result = (rest: { ok: true; answers: Record<string, DecisionAnswer> } | { ok: false; failure: ClassifyFailure | "late"; status: number | null }, latencyMs: number): DecideResult => ({
        model: "simulated",
        usage: {},
        costCents: 0,
        costMicrocents: 0,
        latencyMs,
        ...rest,
      });
      const delayMs = decision.delayMs ?? 0;
      const answered = (): DecideResult => result("answers" in decision ? { ok: true, answers: decision.answers } : { ok: false, failure: decision.failure, status: decision.status ?? null }, delayMs);
      const timeoutMs = options.timeoutMs;
      if (timeoutMs === undefined && delayMs === 0) return Promise.resolve(answered());
      return new Promise((resolve) => {
        let settled = false;
        const settle = (value: DecideResult): void => {
          if (settled) return;
          settled = true;
          cancelAnswer();
          cancelDeadline();
          resolve(value);
        };
        let cancelAnswer: () => void = () => undefined;
        let cancelDeadline: () => void = () => undefined;
        if (timeoutMs !== undefined) cancelDeadline = schedule(() => settle(result({ ok: false, failure: "late", status: null }, timeoutMs)), timeoutMs);
        if (timeoutMs !== undefined && delayMs >= timeoutMs) return;
        if (delayMs === 0) settle(answered());
        else cancelAnswer = schedule(() => settle(answered()), delayMs);
      });
    },
    checkKey: async () => ({ result: "not_needed" }),
  };
}

export default createSimulatedDecider();
