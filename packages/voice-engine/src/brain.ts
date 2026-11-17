// Mora num arquivo só de tipos, exportado também por `@deskvoice/voice-engine/brain`: o painel
// importa daqui sem puxar a descoberta por pasta (o mesmo motivo de `./types`).
import type { ToolSpec, Usage } from "./types";

/** O preço de um modelo de texto, em centavos de dólar por milhão de tokens. Cabe em `EnginePricing`. */
export interface BrainPrice {
  centsPerMillionInputTokens: number;
  centsPerMillionOutputTokens: number;
  centsPerMillionCachedInputTokens?: number;
  /** De onde o número veio: a URL da página de preços, ou da resposta da API que o trouxe. */
  source: string;
  /** Quando foi conferido (AAAA-MM-DD). Na lista lida da API, é o dia da leitura. */
  checkedOn: string;
}

export interface BrainModel {
  /** O id que vai no pedido, exatamente como o provedor publica. */
  id: string;
  /** O nome que a tela mostra; sem nome publicado, o id. */
  label: string;
  contextTokens?: number;
  /** Ausente é "preço não conhecido": nunca zero inventado. Zero só se o provedor publica zero. */
  price?: BrainPrice;
}

/** O vocabulário fechado de `KEY_CHECK_RESULTS`, menos `not_needed` e `model_unavailable`. */
export type BrainFailure = "rejected" | "no_credit" | "region_unavailable" | "rate_limited" | "unreachable" | "unexpected_response";

export type BrainModelsResult = { ok: true; models: BrainModel[] } | { ok: false; failure: BrainFailure; status: number | null };

export interface BrainJsonRequest {
  model: string;
  prompt: string;
  /** O formato pedido, nas duas formas que existem hoje em analysis.ts e outcome.ts. */
  schema: { name: string; strict: object; google: object };
  timeoutMs: number;
}

export type BrainJsonResult = { model: string; usage: Usage } & (
  | { ok: true; text: string }
  // `status` é o HTTP da resposta; `null` quando ela não veio (prazo, rede).
  | { ok: false; failure: BrainFailure; status: number | null }
);

export interface BrainListOptions {
  fetch?: typeof fetch;
  /** Prazo da lista. Padrão: 10 s. */
  timeoutMs?: number;
  /** O dia de hoje (AAAA-MM-DD), do `Clock` de quem chama: é a data do preço lido da API. */
  today: string;
}

/** Uma mensagem da conversa com o cérebro. `args` é texto, exatamente como o modelo pediu. */
export interface BrainChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Em `tool`: a chamada que este resultado responde. */
  toolCallId?: string;
  /** Em `assistant`: as ferramentas que o modelo pediu nesta volta. */
  toolCalls?: { id: string; name: string; args: string }[];
}

export interface BrainChatRequest {
  model: string;
  messages: BrainChatMessage[];
  tools: ToolSpec[];
  /** Prazo do pedido inteiro, do envio ao fim do texto. Estourado, é `error("unreachable", null)`. */
  timeoutMs: number;
}

export interface BrainChatEvents {
  /** Texto da resposta, em pedaços, assim que chega. */
  text(delta: string): void;
  /**
   * O modelo pediu uma ferramenta, já montada. `args` é texto: quem executa valida com zod (convenção 16).
   * Sai assim que a ferramenta fecha, antes do fim do pedido: por isso pode vir `toolCall` e depois
   * `error`, e isso é válido; quem executa decide se usa uma ferramenta de uma volta que falhou.
   */
  toolCall(call: { id: string; name: string; args: string }): void;
  /**
   * O consumo do pedido. Todo pedido que saiu emite **exatamente um**, antes de `done` ou `error`, ou
   * depois de `cancel`. `estimated: false` quando o provedor declarou; `true` quando não declarou
   * (corte, prazo, `cancel`, provedor que não manda), pela regra do Jev: um token por byte UTF-8 de
   * `messages` + `tools` enviados na entrada, e do texto + `args` recebidos na saída. Resposta de erro
   * HTTP (fora de 2xx) é recusa e vem sem custo (`{}`, `false`), como no Jev. Pedido que nem saiu (a
   * rede recusou a conexão) não tem `usage`.
   */
  usage(usage: Usage, estimated: boolean): void;
  /** O texto terminou. Não vem depois de `error` nem de `cancel`. */
  done(): void;
  /** O fim com falha, no vocabulário fechado. `status` é o HTTP; `null` sem resposta (prazo, rede). */
  error(failure: BrainFailure, status: number | null): void;
}

export interface BrainChat {
  on<K extends keyof BrainChatEvents>(event: K, handler: BrainChatEvents[K]): void;
  /** Interrupção: aborta o pedido em voo. Depois dela, nem `text` nem `toolCall`: só o `usage` estimado. */
  cancel(): void;
}

/**
 * Um provedor de texto. Só faz texto: voz em tempo real é do motor, e a chave do cérebro é dele.
 * Descoberto por pasta (`loadBrains`): cérebro novo é só um arquivo novo em `brains/`.
 */
export interface Brain {
  id: string;
  label: string;
  /** Onde a pessoa pega a chave: o link da tela de credenciais. */
  keyUrl: string;
  /** Lista os modelos de texto que a chave alcança. Prova a chave: é o teste da tela. */
  listModels(apiKey: string, options: BrainListOptions): Promise<BrainModelsResult>;
  /** Um pedido com saída em JSON. Nunca lança; nunca registra a chave nem o corpo do provedor. */
  completeJson(apiKey: string, request: BrainJsonRequest, options: { fetch?: typeof fetch }): Promise<BrainJsonResult>;
  /**
   * A conversa em streaming, com ferramentas (R5, fatias 2 e 2b). Opcional: cérebro sem `chat` continua
   * válido e só não aparece na lista do pipeline. Nunca lança; nunca registra a chave nem o corpo.
   */
  chat?(apiKey: string, request: BrainChatRequest, options: { fetch?: typeof fetch }): BrainChat;
}
