import type { Clock } from "@deskvoice/core";

export type Logger = (level: "info" | "error", message: string, fields?: Record<string, unknown>) => void;

/** Uma linha de JSON por evento, na saída padrão: é o que o `docker logs` e qualquer coletor leem. */
export function createLogger(clock: Clock, write: (line: string) => void = (line) => void process.stdout.write(line)): Logger {
  return (level, message, fields = {}) => write(`${JSON.stringify({ at: clock.now().toISOString(), level, message, ...fields })}\n`);
}

export const silentLogger: Logger = () => undefined;

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
