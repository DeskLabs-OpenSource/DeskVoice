import type { CallEvent } from "./types";

/**
 * O selo de temperatura do detalhe da chamada (desenho R6, fatia 4): a última temperatura que o
 * analista leu a tempo. `null` sem analista, com a temperatura desligada, ou sem leitura a tempo. A
 * leitura atrasada ou que falhou não entra: ela não diz nada da conversa.
 */
export function lastTemperature(events: readonly CallEvent[]): { score: number; at: string } | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind !== "analyst_read" || event.payload.onTime !== true) continue;
    const temperature = event.payload.temperature;
    if (typeof temperature !== "object" || temperature === null || !("score" in temperature)) continue;
    const score = Number(temperature.score);
    if (Number.isFinite(score)) return { score, at: event.at };
  }
  return null;
}
