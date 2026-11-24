import { z } from "zod";
import type { BrainPrice } from "./brain";
import type { SpeechSynthesizer } from "./types";

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
  const brainPrice: BrainPrice | undefined = storedBrainPrices.safeParse(brainModels).data?.models.find((model) => model.id === choice.model)?.price;
  if (brainPrice === undefined) return { unpriced: { kind: "brain", id: choice.brain, model: choice.model } };
  if (synthesizer.pricingOf(synthesizer.defaultModel) === undefined) return { unpriced: { kind: "synthesizer", id: synthesizer.id, model: synthesizer.defaultModel } };
  return { brainPrice };
}
