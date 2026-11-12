/** Definição de ferramenta no formato que os motores entendem (JSON Schema em `parameters`). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VoiceSessionConfig {
  instructions: string;
  /** Fala de abertura. O agente fala primeiro quando presente. */
  greeting?: string;
  voiceId?: string;
  /** BCP 47, ex.: "pt-BR". */
  language: string;
  tools: ToolSpec[];
}

export interface Usage {
  seconds?: number;
  /** Tokens de entrada no preço cheio (áudio, quando o motor separa; todos, quando não separa). */
  inputTokens?: number;
  outputTokens?: number;
  /** Quando o motor separa: entrada de texto (instruções, resultados de ferramenta), entrada em cache e saída de texto. */
  textInputTokens?: number;
  cachedInputTokens?: number;
  textOutputTokens?: number;
}

export interface VoiceSessionEvents {
  /** Fala do agente. Sempre PCM16 mono 8 kHz, em pedaços de qualquer tamanho. */
  audio(pcm16_8k: Buffer): void;
  transcript(turn: { speaker: "user" | "agent"; text: string }): void;
  toolCall(call: { id: string; name: string; args: unknown }): void;
  /** O usuário falou por cima: quem toca o áudio deve descartar o que ainda não saiu. */
  interrupted(): void;
  /** Incremento desde o último `usage` (não é acumulado): quem mede custo soma os eventos. */
  usage(usage: Usage): void;
  /** Seguido de `closed` quando é fatal; sozinho, a sessão continua. */
  error(error: Error): void;
  closed(reason: string): void;
}

export interface VoiceSession {
  on<K extends keyof VoiceSessionEvents>(event: K, handler: VoiceSessionEvents[K]): void;
  /** Áudio de quem ligou. Sempre PCM16 mono 8 kHz. */
  sendAudio(pcm16_8k: Buffer): void;
  sendToolResult(id: string, result: unknown): void;
  /** Pede ao motor uma fala com este conteúdo (aviso de gravação, desculpa, espera). */
  say(text: string): void;
  close(): Promise<void>;
}

export interface EnginePricing {
  /** Centavos de dólar por minuto de conversa, quando o provedor cobra por tempo. */
  centsPerMinute?: number;
  /** Centavos de dólar por milhão de tokens de áudio. */
  centsPerMillionInputTokens?: number;
  centsPerMillionOutputTokens?: number;
  /** Preços menores que o provedor cobra por texto e por entrada em cache. Sem eles, vale o preço cheio. */
  centsPerMillionTextInputTokens?: number;
  centsPerMillionCachedInputTokens?: number;
  centsPerMillionTextOutputTokens?: number;
  /** Data em que o preço foi conferido na página do provedor (AAAA-MM-DD). */
  checkedOn: string;
  source: string;
}

export interface ConnectOptions {
  /** Sobrepõe o modelo padrão do motor. */
  model?: string;
  /** Sobrepõe a URL do WebSocket do provedor (testes apontam para um servidor falso). */
  baseUrl?: string;
  /** Prazo para a conexão abrir e, depois, para o provedor confirmar a sessão. Padrão: 10 s cada. */
  readyTimeoutMs?: number;
  /** Agendador do prazo (`setTimeout` por padrão). Devolve como cancelar. */
  schedule?: (fn: () => void, delayMs: number) => () => void;
}

/**
 * O provedor não respondeu no prazo ao abrir a sessão. Quem ligou já foi atendido: a chamada
 * precisa sair do silêncio, então quem chama `connect` trata isto como recusa, e não espera.
 */
export class EngineTimeoutError extends Error {}

/**
 * O resultado do teste de uma chave, num vocabulário fechado: a tela e a saúde traduzem o código,
 * e nunca repassam o texto do provedor.
 */
export const KEY_CHECK_RESULTS = [
  /** A chave foi aceita e dá acesso ao modelo que o motor usa. */
  "accepted",
  /** O provedor recusou a chave (inválida, revogada ou sem permissão). */
  "rejected",
  /** A chave foi aceita, mas o modelo que o motor usa não existe para ela. */
  "model_unavailable",
  /** O provedor disse que falta crédito ou que o limite de gasto da conta foi atingido. */
  "no_credit",
  /** O provedor não atende o país, a região ou o território de onde o servidor fala com ele. */
  "region_unavailable",
  /** O provedor pediu para esperar (limite de pedidos). */
  "rate_limited",
  /** Sem resposta no prazo, sem rede, ou erro do lado do provedor (5xx). */
  "unreachable",
  /** O provedor respondeu algo que não é o que a documentação descreve. */
  "unexpected_response",
  /** O motor não usa chave. */
  "not_needed",
] as const;
export type KeyCheckResult = (typeof KEY_CHECK_RESULTS)[number];

export interface KeyCheck {
  result: KeyCheckResult;
  /** O modelo conferido (o mesmo que `connect` abre). Ausente no motor sem chave. */
  model?: string;
}

export interface KeyCheckOptions {
  /** Sobrepõe o modelo padrão do motor. */
  model?: string;
  /** Sobrepõe a URL da API HTTP do provedor (testes apontam para um servidor falso). */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Prazo da resposta. Padrão: 10 s. */
  timeoutMs?: number;
  /** Agendador do prazo (`setTimeout` por padrão). Devolve como cancelar. */
  schedule?: (fn: () => void, delayMs: number) => () => void;
}

export interface VoiceEngine {
  id: string;
  label: string;
  /** Verdadeiro para motores que não precisam de chave (o simulado). */
  keyless?: boolean;
  pricing: EnginePricing;
  connect(config: VoiceSessionConfig, apiKey: string, options?: ConnectOptions): Promise<VoiceSession>;
  /**
   * Confere a chave sem abrir sessão de voz e sem gastar: a chamada mais barata do provedor que
   * prova que a chave vale e alcança o modelo de `connect`. Nunca lança, nunca registra a chave.
   */
  checkKey(apiKey: string, options?: KeyCheckOptions): Promise<KeyCheck>;
}
