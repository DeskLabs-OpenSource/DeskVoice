import { pipelineChoice, pricedBrainModels, type PipelineChoice } from "@deskvoice/voice-engine/pipeline-choice";
import type { Engine } from "../../../../ui/types";
import type { PipelineBrainOption, PipelineSynthesizer, PipelineTranscriber } from "./pipeline-block";

/**
 * As peças do Pipeline no rascunho do agente (fatia 6b). Vazio é "a primeira da lista" (a transcrição, o
 * cérebro, o modelo com preço); a peça gravada que saiu da lista não é trocada por outra; a voz não tem padrão: quem configura a escolhe, ouvindo a amostra.
 */
export type PipelinePieces = Record<keyof PipelineChoice, string>;
export const NO_PIECES: PipelinePieces = { transcriber: "", brain: "", model: "", synthesizer: "", voiceId: "" };

/** A escolha gravada no agente, ou nenhuma peça quando a coluna é nula ou está fora da forma. */
export const piecesOf = (stored: unknown): PipelinePieces => pipelineChoice.safeParse(stored).data ?? NO_PIECES;

/** As leituras do bloco: `undefined` enquanto carrega. */
export interface PipelineData {
  transcribers: readonly PipelineTranscriber[] | undefined;
  brains: readonly PipelineBrainOption[] | undefined;
  synthesizers: readonly PipelineSynthesizer[] | undefined;
}

const confirmed = (piece: { processingLocation: { kind: string }; consent: unknown }): boolean => piece.processingLocation.kind === "this-server" || piece.consent !== null;

/** As transcrições que o Pipeline pode usar: com a chave na organização e o envio confirmado (9.1). */
export const usableTranscribers = (transcribers: readonly PipelineTranscriber[] | undefined): PipelineTranscriber[] =>
  (transcribers ?? []).filter((transcriber) => transcriber.keyConfigured && confirmed(transcriber));
/** As vozes que o Pipeline pode usar: com a chave salva e o envio confirmado (9.1). */
export const usableSynthesizers = (synthesizers: readonly PipelineSynthesizer[] | undefined): PipelineSynthesizer[] =>
  (synthesizers ?? []).filter((synthesizer) => synthesizer.configured && confirmed(synthesizer));
/** Os cérebros que conversam, com a chave aceita. */
export const conversationalBrains = (brains: readonly PipelineBrainOption[] | undefined): PipelineBrainOption[] =>
  (brains ?? []).filter((brain) => brain.chat && brain.configured && brain.keyCheck?.result === "accepted");

/** Por que o Pipeline não pode ser escolhido: o motivo do servidor, ou a peça que falta nesta organização. */
export type PipelineMissing = "no_live_transcriber" | "no_transcriber_key" | "transcriber_unconfirmed" | "no_brain" | "no_voice" | "loading" | "unknown";

/**
 * O Pipeline está montado (fatia 6b) quando o servidor não diz o que falta e a organização tem uma
 * transcrição com chave e confirmação, um cérebro que conversa com a chave aceita e uma voz com chave e
 * confirmação. Parte da régua de `requirePipeline`, lida antes, e é mais dura na chave de cada peça; o preço
 * da voz fica com o 422 do servidor, com o motivo.
 */
export function pipelineMissing(pipeline: Engine, data: PipelineData): PipelineMissing | null {
  if (pipeline.unavailable === undefined) return "unknown";
  if (pipeline.unavailable !== null) return pipeline.unavailable.reason;
  if (data.transcribers === undefined || data.brains === undefined || data.synthesizers === undefined) return "loading";
  if (usableTranscribers(data.transcribers).length === 0) return "transcriber_unconfirmed";
  if (conversationalBrains(data.brains).length === 0) return "no_brain";
  if (usableSynthesizers(data.synthesizers).length === 0) return "no_voice";
  return null;
}

/**
 * A peça mostrada: o vazio é a primeira da lista; a gravada fica a gravada, mesmo fora da lista (a
 * confirmação apagada, a chave que deixou de estar aceita, o modelo sem preço). A tela nunca mostra como
 * do agente uma peça que ele não usa: o bloco diz que a gravada saiu da lista, e o salvar a recusa.
 */
const shown = (options: readonly string[], id: string): string => (id === "" ? (options[0] ?? "") : id);

/** As peças que o bloco mostra escolhidas: o rascunho, com o vazio trocado pela primeira da lista. */
export function shownPieces(pieces: PipelinePieces, data: PipelineData, brainModels: unknown): PipelinePieces {
  const brain = shown(ids(conversationalBrains(data.brains)), pieces.brain);
  return {
    transcriber: shown(ids(usableTranscribers(data.transcribers)), pieces.transcriber),
    brain,
    // Os modelos são os do cérebro mostrado; com o cérebro fora da lista, nenhum (`usePipelineData` não os lê).
    model: shown(brainModels === undefined || !inList(conversationalBrains(data.brains), brain) ? [] : pricedBrainModels(brainModels), pieces.model),
    synthesizer: pieces.synthesizer,
    voiceId: pieces.voiceId,
  };
}

const ids = (options: readonly { id: string }[]): string[] => options.map((option) => option.id);
/** A peça está na lista que o bloco oferece. */
export const inList = (options: readonly { id: string }[], id: string): boolean => options.some((option) => option.id === id);

/** A escolha que vai no salvar, ou a peça que ainda falta escolher (vazia ou fora da lista). */
export function choiceToSave(pieces: PipelinePieces, data: PipelineData, brainModels: unknown): { choice: PipelineChoice } | { missing: "transcriber" | "brain" | "model" | "voice" } {
  const choice = shownPieces(pieces, data, brainModels);
  if (!inList(usableTranscribers(data.transcribers), choice.transcriber)) return { missing: "transcriber" };
  if (!inList(conversationalBrains(data.brains), choice.brain)) return { missing: "brain" };
  if (brainModels === undefined || !pricedBrainModels(brainModels).includes(choice.model)) return { missing: "model" };
  if (choice.voiceId === "" || !inList(usableSynthesizers(data.synthesizers), choice.synthesizer)) return { missing: "voice" };
  return { choice };
}

/** Iguais as duas escolhas (a gravada e a do rascunho): o salvar não regrava a mesma. */
export const sameChoice = (a: PipelineChoice | null, b: PipelineChoice | null): boolean =>
  a === b || (a !== null && b !== null && (Object.keys(a) as (keyof PipelineChoice)[]).every((key) => a[key] === b[key]));

/**
 * O que o salvar leva em `pipeline` (fatia 6b): nada quando a escolha não mudou, `null` ao sair do
 * Pipeline, ou a escolha nova (ou a peça que falta). A comparação é com o rascunho cru, antes de
 * `shownPieces`: salvar outro campo não regrava a escolha, nem esbarra numa peça que saiu da lista
 * (confirmação apagada, chave que deixou de estar aceita).
 */
export function pipelineToSave(
  pipelineOn: boolean,
  pieces: PipelinePieces,
  saved: PipelineChoice | null,
  data: PipelineData,
  brainModels: unknown,
): { unchanged: true } | { choice: PipelineChoice | null } | { missing: "transcriber" | "brain" | "model" | "voice" } {
  if (!pipelineOn) return saved === null ? { unchanged: true } : { choice: null };
  if (saved !== null && sameChoice(pieces, saved)) return { unchanged: true };
  const toSave = choiceToSave(pieces, data, brainModels);
  return "choice" in toSave && sameChoice(toSave.choice, saved) ? { unchanged: true } : toSave;
}
