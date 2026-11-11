type Stop = () => Promise<void>;
export type StartListening = (onPayload: (payload: string) => void, onError: (error: Error) => void) => Promise<Stop>;

export interface CallEventSignal {
  callId: string;
  eventId: string;
}

interface Subscriber {
  organizationId: string;
  onEvent(event: CallEventSignal): void;
  onClose(): void;
}

/**
 * Reparte UMA escuta de `call_events` entre todos os clientes de SSE do processo. Cada escuta
 * segura uma conexão do pool; uma por aba aberta esgotaria o banco.
 *
 * A escuta abre com o primeiro cliente e fecha quando o último sai. Se a conexão cair, todos os
 * clientes são encerrados: o navegador reconecta sozinho e a próxima inscrição reabre a escuta.
 */
export function createEventHub(start: StartListening) {
  const subscribers = new Set<Subscriber>();
  let listening: Promise<Stop> | undefined;

  const dispatch = (payload: string): void => {
    // Formato do gatilho do banco: `organization_id:call_id:event_id`.
    const [organizationId, callId, eventId] = payload.split(":");
    if (!organizationId || !callId || !eventId) return;
    for (const subscriber of subscribers) {
      if (subscriber.organizationId === organizationId) subscriber.onEvent({ callId, eventId });
    }
  };

  const drop = (): void => {
    listening = undefined;
    const current = [...subscribers];
    subscribers.clear();
    for (const subscriber of current) subscriber.onClose();
  };

  return {
    async subscribe(subscriber: Subscriber): Promise<() => Promise<void>> {
      subscribers.add(subscriber);
      listening ??= start(dispatch, drop);
      try {
        await listening;
      } catch (error) {
        subscribers.delete(subscriber);
        listening = undefined;
        throw error;
      }
      return async () => {
        if (!subscribers.delete(subscriber) || subscribers.size > 0 || !listening) return;
        const stop = listening;
        listening = undefined;
        await (await stop)();
      };
    },
    size: (): number => subscribers.size,
  };
}

export type EventHub = ReturnType<typeof createEventHub>;
