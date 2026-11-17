// Mora num arquivo só de tipos, exportado também por `@deskvoice/voice-engine/brain`: o painel
// importa daqui sem puxar a descoberta por pasta (o mesmo motivo de `./types`).
import type { Usage } from "./types";

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
}
