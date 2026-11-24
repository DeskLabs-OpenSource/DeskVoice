import type { OrgQuery } from "@deskvoice/core";
import { pricePipeline, type PipelineChoice } from "@deskvoice/voice-engine/pipeline-choice";
// Pelo caminho dos tipos: o índice do pacote carrega a descoberta por pasta, que não existe no pacote do Next.
import type { PipelinePieceKind, ProcessingLocation } from "@deskvoice/voice-engine/types";
import { brainModelsSetting, listBrains } from "./brains";
import { ApiError, type ServerDeps } from "./context";
import { listAllSynthesizers, readConsent, synthesizerConsentSetting } from "./synthesizers";
import { listTranscribers } from "./transcribers";

/** A peça simulada (sem chave, sem fornecedor) serve aos testes e à prova de primeira impressão, nunca a um agente de verdade. */
const SIMULATED = "simulated";

const PIECE_NAMES: Record<PipelinePieceKind, string> = { transcriber: "transcriber", brain: "brain", synthesizer: "voice" };

const refuse = (code: string, piece: PipelinePieceKind, id: string, message: string, extra: Record<string, string> = {}): ApiError =>
  new ApiError(422, code, message, { piece, pieceId: id, ...extra });

const leavesServer = (location: ProcessingLocation): boolean => location.kind !== "this-server";

/**
 * Confere a escolha das peças do pipeline antes de gravar em `agents.pipeline` (desenho do pipeline,
 * fatia 5 e seção 9.1). Nula (o motor direto) e ausente não pedem nada. Cada recusa é 422 e diz qual
 * peça, no `detail` e na frase:
 *
 * 1. a peça que não está na pasta (`pipeline_piece_unknown`);
 * 2. a peça simulada fora do ambiente de teste (`pipeline_piece_test_only`): só `deps.simulatedPieces`
 *    a aceita, e a instalação nunca o liga;
 * 3. o cérebro sem `chat` (`pipeline_brain_cannot_chat`);
 * 4. o modelo do cérebro, ou o da voz, sem preço conhecido (`pipeline_piece_unpriced`), pela mesma
 *    regra da abertura da ligação (`pricePipeline`, 3b-2);
 * 5. a peça que leva o dado de quem ligou para fora do servidor sem a confirmação gravada
 *    (`pipeline_piece_unconfirmed`, seção 9.1). A da voz é a da fatia 1b (`synthesizer.<id>.consent`);
 *    a da transcrição ainda não existe (é da R12), e por isso nenhuma transcrição de fora passa.
 *
 * A confirmação e a lista de preços ficam travadas até o fim da escrita: apagadas no meio, a escolha
 * não passa.
 */
export async function requirePipeline(q: OrgQuery, deps: Pick<ServerDeps, "simulatedPieces">, choice: PipelineChoice | null | undefined): Promise<void> {
  if (choice === null || choice === undefined) return;
  const transcriber = (await listTranscribers()).find((piece) => piece.id === choice.transcriber);
  if (!transcriber) throw refuse("pipeline_piece_unknown", "transcriber", choice.transcriber, `"${choice.transcriber}" is not a known transcriber.`);
  const brain = (await listBrains()).find((piece) => piece.id === choice.brain);
  if (!brain) throw refuse("pipeline_piece_unknown", "brain", choice.brain, `"${choice.brain}" is not a known brain.`);
  const synthesizer = (await listAllSynthesizers()).find((piece) => piece.id === choice.synthesizer);
  if (!synthesizer) throw refuse("pipeline_piece_unknown", "synthesizer", choice.synthesizer, `"${choice.synthesizer}" is not a known voice.`);

  for (const [kind, id] of [
    ["transcriber", transcriber.id],
    ["synthesizer", synthesizer.id],
  ] as const) {
    if (id === SIMULATED && deps.simulatedPieces !== true)
      throw refuse("pipeline_piece_test_only", kind, id, `The simulated ${PIECE_NAMES[kind]} only serves tests: choose a real ${PIECE_NAMES[kind]} for this agent.`);
  }

  if (!brain.chat) throw refuse("pipeline_brain_cannot_chat", "brain", brain.id, `The brain "${brain.id}" cannot hold a conversation: choose another brain for the pipeline.`);

  const models = await q.one<{ value: unknown }>("select value from settings where key = $1 for share", [brainModelsSetting(brain.id)]);
  const priced = pricePipeline(choice, models?.value, synthesizer);
  if ("unpriced" in priced) {
    const { kind, id, model } = priced.unpriced;
    throw refuse(
      "pipeline_piece_unpriced",
      kind,
      id,
      kind === "brain"
        ? `The model "${model}" of the brain "${id}" has no known price: without a price, the cost of the call cannot be measured. Choose a model with a price in Settings → Brains.`
        : `The model "${model}" of the voice "${id}" has no known price: without a price, the cost of the call cannot be measured.`,
      { model },
    );
  }

  if (leavesServer(transcriber.processingLocation)) {
    throw refuse(
      "pipeline_piece_unconfirmed",
      "transcriber",
      transcriber.id,
      `${transcriber.label} receives the caller's audio, outside this server, and this version has no place to confirm it yet: choose a transcriber that runs on this server.`,
    );
  }
  if (leavesServer(synthesizer.processingLocation)) {
    const consent = readConsent((await q.one<{ value: unknown }>("select value from settings where key = $1 for share", [synthesizerConsentSetting(synthesizer.id)]))?.value);
    if (consent === null)
      throw refuse(
        "pipeline_piece_unconfirmed",
        "synthesizer",
        synthesizer.id,
        `${synthesizer.label} receives the text the agent speaks on the call, outside this server, and nobody has confirmed it: confirm it in Settings → Voice before choosing this voice.`,
      );
  }
}
