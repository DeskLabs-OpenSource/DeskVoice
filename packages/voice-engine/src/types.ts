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
  inputTokens?: number;
  outputTokens?: number;
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
  /** Data em que o preço foi conferido na página do provedor (AAAA-MM-DD). */
  checkedOn: string;
  source: string;
}

export interface ConnectOptions {
  /** Sobrepõe o modelo padrão do motor. */
  model?: string;
  /** Sobrepõe a URL do WebSocket do provedor (testes apontam para um servidor falso). */
  baseUrl?: string;
}

export interface VoiceEngine {
  id: string;
  label: string;
  /** Verdadeiro para motores que não precisam de chave (o simulado). */
  keyless?: boolean;
  pricing: EnginePricing;
  connect(config: VoiceSessionConfig, apiKey: string, options?: ConnectOptions): Promise<VoiceSession>;
}
