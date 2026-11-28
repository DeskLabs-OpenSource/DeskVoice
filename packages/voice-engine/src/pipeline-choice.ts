import { z } from "zod";
import type { BrainPrice } from "./brain";
import type { SpeechSynthesizer, StreamingTranscriber } from "./types";

/**
 * A escolha gravada em `agents.pipeline` (desenho do pipeline, seção 3.3 e fatia 3): uma forma só,
 * a que a sessão lê na abertura e a que a rota do agente grava (fatia 5a). Fora da forma (gravada à
 * mão), o pipeline não abre, e a ligação é recusada com o motivo.
 */
export const pipelineChoice = z.object({
  transcriber: z.string().min(1),
  brain: z.string().min(1),
  model: z.string().min(1),
  synthesizer: z.string().min(1),
  voiceId: z.string().min(1),
});
export type PipelineChoice = z.infer<typeof pipelineChoice>;

/** O preço do modelo, como a tela grava a lista em `brain.<id>.models` (a mesma forma de `apps/panel/src/server/brains.ts`). */
const cents = z.number().finite().nonnegative();
const storedBrainPrices = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      price: z
        .object({
          centsPerMillionInputTokens: cents,
          centsPerMillionOutputTokens: cents,
          centsPerMillionCachedInputTokens: cents.optional(),
          source: z.string(),
          checkedOn: z.string(),
        })
        .optional(),
    }),
  ),
});

/**
 * O preço de um modelo na lista do cérebro (`brain.<id>.models`, como a tela grava e a rota de modelos
 * devolve), ou `undefined`. É a regra do cérebro em `pricePipeline`, e a que a tela do agente usa para
 * oferecer só modelo com preço (fatia 5b-1).
 */
export const brainPriceOf = (brainModels: unknown, modelId: string): BrainPrice | undefined => storedBrainPrices.safeParse(brainModels).data?.models.find((model) => model.id === modelId)?.price;

/** Os modelos da lista que têm preço conhecido, na ordem dela. */
export const pricedBrainModels = (brainModels: unknown): string[] =>
  (storedBrainPrices.safeParse(brainModels).data?.models ?? []).filter((model) => model.price !== undefined).map((model) => model.id);

/** A peça sem preço conhecido, e o modelo dela. */
export type UnpricedPiece = { kind: "brain" | "synthesizer"; id: string; model: string };

/**
 * A regra de `pipeline_piece_unpriced` (3b-2), uma só para a abertura da ligação e para a gravação
 * do agente (fatia 5a). O preço do cérebro vem só da lista que a tela gravou (`brainModels`, o valor
 * de `brain.<id>.models`): o modelo fora dela, ou nela sem preço, não tem preço conhecido. A voz cobra
 * pelo modelo dela, e a escolha não traz modelo: vale o padrão da peça. A transcrição tem `pricing`
 * obrigatório, e nunca fica sem preço.
 */
export function pricePipeline(
  choice: Pick<PipelineChoice, "brain" | "model">,
  brainModels: unknown,
  synthesizer: Pick<SpeechSynthesizer, "id" | "defaultModel" | "pricingOf">,
): { brainPrice: BrainPrice } | { unpriced: UnpricedPiece } {
  const brainPrice = brainPriceOf(brainModels, choice.model);
  if (brainPrice === undefined) return { unpriced: { kind: "brain", id: choice.brain, model: choice.model } };
  if (synthesizer.pricingOf(synthesizer.defaultModel) === undefined) return { unpriced: { kind: "synthesizer", id: synthesizer.id, model: synthesizer.defaultModel } };
  return { brainPrice };
}

/**
 * A confirmação nomeando o fornecedor (seção 9.1, fatia 1b), como a tela grava em
 * `synthesizer.<id>.consent`: quem confirmou e quando. Uma forma só, para a tela, para a gravação do
 * agente (fatia 5a) e para a abertura da ligação (fatia 5b-1). Fora da forma, não há confirmação.
 */
const storedConsent = z.object({ userId: z.string(), confirmedAt: z.string() });
export type PieceConsent = z.infer<typeof storedConsent>;
export const readConsent = (value: unknown): PieceConsent | null => storedConsent.safeParse(value).data ?? null;
/** Onde a tela grava a confirmação da voz. Sai junto com a chave. */
export const synthesizerConsentSetting = (id: string): string => `synthesizer.${id}.consent`;
/**
 * Onde a tela grava a confirmação da transcrição de fora do servidor (seção 9.1, fatia 6): "O áudio da
 * pessoa na ligação vai para <fornecedor>". Na mesma forma da voz. A transcrição da OpenAI não tem
 * chave própria (usa a do motor), e por isso a confirmação tem rota própria, e não sai com a chave.
 */
export const transcriberConsentSetting = (id: string): string => `transcriber.${id}.consent`;
/** A chave da organização que a transcrição usa: a declarada pela peça (`keySetting`), ou `transcriber.<id>.api_key`. */
export const transcriberKeySettingOf = (piece: Pick<StreamingTranscriber, "id" | "keySetting">): string => piece.keySetting ?? `transcriber.${piece.id}.api_key`;
