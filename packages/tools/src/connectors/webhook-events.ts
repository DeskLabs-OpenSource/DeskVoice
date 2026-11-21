// Sem dependência: o painel lê daqui o vocabulário dos eventos que um webhook pode pedir.

/**
 * Os acontecimentos que um webhook cadastrado pode pedir para receber (`events` em
 * `webhooks.allowed`). Ausente ou vazio é nenhum: o webhook só é chamado pelo agente, durante a
 * ligação (`call_webhook`), como antes.
 * - `call.report`: o relatório de cada ligação, depois do resumo e da leitura (desfecho e análise).
 */
export const WEBHOOK_EVENTS = ["call.report"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
