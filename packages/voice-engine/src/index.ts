export * from "./types";
export * from "./resample";
export * from "./pricing";
export * from "./load";
export * from "./outcome";
export * from "./analysis";
export * from "./transcription";
export { createSimulatedEngine, setSimulatedScript, SIMULATED_PREFIX } from "./engines/simulated";
export type { SimulatedScript, SimulatedStep } from "./engines/simulated";
export * from "./brain";
export { loadBrains } from "./brain-load";
// O motor pipeline mora em `engines/pipeline.ts` (fatia 5b-1) e é descoberto pela pasta, como os outros:
// quem abre a ligação o acha em `loadEngines()` por `isPipelineEngine`, e o contrato fica em `types.ts`.
export { pipelineChoice, pricePipeline, readConsent, synthesizerConsentSetting, type PieceConsent, type PipelineChoice, type UnpricedPiece } from "./pipeline-choice";
export * from "./speech-filter";
export * from "./analyst";
export { createSimulatedDecider, neutralAnswers } from "./deciders/simulated";
export type { SimulatedDecision } from "./deciders/simulated";
