import type { ProcessingLocation } from "@deskvoice/voice-engine/types";
import type { Analyst } from "../../../../ui/types";

/** Um modelo de decisão como a tela do filtro o lista (`/speech-filter`): da chave, só se existe. */
export interface DecisionModelView {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  keyless: boolean;
  key: { configured: boolean };
}

/** Pronto para o analista: não pede chave, ou tem a chave salva. Sem chave, nada vai ao fornecedor. */
export const isReady = (model: DecisionModelView): boolean => model.keyless || model.key.configured;

/**
 * Os modelos que a tela oferece ao analista: os instalados e com chave (desenho R6, fatia 4). O modelo
 * já gravado no analista em edição continua na lista, mesmo sem chave, para a escolha não sumir em
 * silêncio; a tela diz por que ele não lê nada.
 */
export function offeredModels(models: readonly DecisionModelView[], current: string | null): DecisionModelView[] {
  return models.filter((model) => isReady(model) || model.id === current);
}

/** O texto da ligação sai deste servidor com este modelo. */
export const leavesServer = (model: DecisionModelView): boolean => model.processingLocation.kind !== "this-server";

/**
 * A tela pede a confirmação nomeando o fornecedor (seção 2.1) quando o modelo processa fora e não há
 * confirmação vigente para ele: analista novo, modelo trocado, ou nunca confirmado. É a mesma regra da
 * rota (`consentFor`): a tela pergunta antes, e a rota recusa se faltar.
 */
export function needsConfirmation(model: DecisionModelView, editing: Pick<Analyst, "decisionModel" | "providerConfirmedAt"> | null): boolean {
  if (!leavesServer(model)) return false;
  return editing === null || editing.decisionModel !== model.id || editing.providerConfirmedAt === null;
}

/**
 * Os motores que entregam a orientação ao agente (`VoiceSession.guide`, desenho R6, seção 3.3). O
 * Gemini Live não entrega na v1; um motor novo entra aqui quando implementar `guide`. Fora da lista, o
 * agente mostra que o analista mede, mas não orienta.
 */
export const GUIDED_ENGINES: readonly string[] = ["openai-realtime", "simulated"];
