import type { VoiceSessionEvents } from "./types";

type AnyHandler = (...args: unknown[]) => void;

export class SessionEmitter {
  private readonly handlers = new Map<keyof VoiceSessionEvents, AnyHandler[]>();

  on<K extends keyof VoiceSessionEvents>(event: K, handler: VoiceSessionEvents[K]): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as AnyHandler);
    this.handlers.set(event, list);
  }

  emit<K extends keyof VoiceSessionEvents>(event: K, ...args: Parameters<VoiceSessionEvents[K]>): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler(...args);
      } catch (cause) {
        // Roda dentro do callback do socket: exceção de quem escuta não pode derrubar o processo.
        // Se quem falhou foi o próprio handler de erro, não há para onde avisar sem entrar em laço.
        if (event === "error") continue;
        this.emit("error", cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
  }
}
