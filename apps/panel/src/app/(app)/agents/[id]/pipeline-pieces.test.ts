// A escolha do Pipeline pela tela (fatia 6b): quando o campo Motor o libera, e o que vai no salvar. A
// régua é a de `requirePipeline` lida antes; o 422 do servidor continua sendo a última palavra.
import { describe, expect, it } from "vitest";
import enCommon from "../../../../i18n/en/common";
import esCommon from "../../../../i18n/es/common";
import ptBRCommon from "../../../../i18n/pt-BR/common";
import { ApiFailure } from "../../../../ui/api";
import { withPiece } from "../../../../ui/errors";
import type { Engine } from "../../../../ui/types";
import type { PipelineBrainOption, PipelineSynthesizer, PipelineTranscriber } from "./pipeline-block";
import { choiceToSave, NO_PIECES, pipelineMissing, piecesOf, pipelineToSave, sameChoice, shownPieces, type PipelineData } from "./pipeline-pieces";

const PIPELINE = { id: "pipeline", assembled: true, unavailable: null } as Engine;
const AT = "2026-11-26T12:00:00.000Z";
const EAR: PipelineTranscriber = { id: "openai", label: "OpenAI", provider: "openai", processingLocation: { kind: "undeclared" }, keyConfigured: true, consent: { name: "Ana", at: AT } };
const BRAIN: PipelineBrainOption = { id: "openai", label: "OpenAI", chat: true, configured: true, keyCheck: { result: "accepted" } };
const VOICE: PipelineSynthesizer = { id: "elevenlabs", label: "ElevenLabs", provider: "elevenlabs", processingLocation: { kind: "undeclared" }, configured: true, consent: { name: "Ana", at: AT } };
const READY: PipelineData = { transcribers: [EAR], brains: [BRAIN], synthesizers: [VOICE] };
const PRICE = { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "teste", checkedOn: "2026-11-26" };
const MODELS = { models: [{ id: "sem-preco" }, { id: "modelo-a", price: PRICE }, { id: "modelo-b", price: PRICE }] };
const CHOICE = { transcriber: "openai", brain: "openai", model: "modelo-b", synthesizer: "elevenlabs", voiceId: "v-bia" };

describe("pipelineMissing: quando o campo Motor libera o Pipeline", () => {
  it("montado: o servidor sem motivo, e a transcrição, o cérebro e a voz prontos na organização", () => {
    expect(pipelineMissing(PIPELINE, READY)).toBeNull();
  });

  it("o motivo do servidor vem antes; sem a marca, o motivo geral", () => {
    expect(pipelineMissing({ ...PIPELINE, unavailable: { reason: "no_transcriber_key" } }, READY)).toBe("no_transcriber_key");
    expect(pipelineMissing({ ...PIPELINE, unavailable: { reason: "no_live_transcriber" } }, READY)).toBe("no_live_transcriber");
    const { unavailable: _, ...unmarked } = PIPELINE;
    expect(pipelineMissing(unmarked as Engine, READY)).toBe("unknown");
  });

  it("carregando qualquer leitura: ainda não libera", () => {
    expect(pipelineMissing(PIPELINE, { ...READY, transcribers: undefined })).toBe("loading");
    expect(pipelineMissing(PIPELINE, { ...READY, brains: undefined })).toBe("loading");
    expect(pipelineMissing(PIPELINE, { ...READY, synthesizers: undefined })).toBe("loading");
  });

  it("a peça sem chave ou sem a confirmação da 9.1 não conta; a deste servidor não precisa de confirmação", () => {
    expect(pipelineMissing(PIPELINE, { ...READY, transcribers: [{ ...EAR, consent: null }] })).toBe("transcriber_unconfirmed");
    expect(pipelineMissing(PIPELINE, { ...READY, transcribers: [{ ...EAR, keyConfigured: false }] })).toBe("transcriber_unconfirmed");
    expect(pipelineMissing(PIPELINE, { ...READY, transcribers: [{ ...EAR, consent: null, processingLocation: { kind: "this-server" } }] })).toBeNull();
    expect(pipelineMissing(PIPELINE, { ...READY, brains: [{ ...BRAIN, chat: false }] })).toBe("no_brain");
    expect(pipelineMissing(PIPELINE, { ...READY, brains: [{ ...BRAIN, keyCheck: { result: "rejected" } }] })).toBe("no_brain");
    expect(pipelineMissing(PIPELINE, { ...READY, synthesizers: [{ ...VOICE, consent: null }] })).toBe("no_voice");
    expect(pipelineMissing(PIPELINE, { ...READY, synthesizers: [{ ...VOICE, configured: false }] })).toBe("no_voice");
  });
});

describe("choiceToSave: o que vai no salvar", () => {
  it("as peças do rascunho, na forma de `agents.pipeline`", () => {
    expect(choiceToSave(CHOICE, READY, MODELS)).toEqual({ choice: CHOICE });
  });

  it("vazio é a primeira da lista: a transcrição, o cérebro e o modelo com preço; a voz, não", () => {
    expect(choiceToSave({ ...NO_PIECES, synthesizer: "elevenlabs", voiceId: "v-bia" }, READY, MODELS)).toEqual({ choice: { ...CHOICE, model: "modelo-a" } });
    expect(choiceToSave({ ...CHOICE, voiceId: "" }, READY, MODELS)).toEqual({ missing: "voice" });
  });

  it("o que saiu da lista não vai: o modelo sem preço cai no primeiro com preço, a voz de conta sem confirmação falta", () => {
    expect(choiceToSave({ ...CHOICE, model: "sem-preco" }, READY, MODELS)).toEqual({ choice: { ...CHOICE, model: "modelo-a" } });
    expect(choiceToSave(CHOICE, { ...READY, synthesizers: [{ ...VOICE, consent: null }] }, MODELS)).toEqual({ missing: "voice" });
    expect(choiceToSave(CHOICE, { ...READY, transcribers: [{ ...EAR, consent: null }] }, MODELS)).toEqual({ missing: "transcriber" });
    expect(choiceToSave(CHOICE, { ...READY, brains: [] }, MODELS)).toEqual({ missing: "brain" });
    expect(choiceToSave(CHOICE, READY, { models: [{ id: "sem-preco" }] })).toEqual({ missing: "model" });
    expect(choiceToSave(CHOICE, READY, undefined)).toEqual({ missing: "model" });
  });

  it("o bloco mostra as mesmas peças que o salvar leva", () => {
    expect(shownPieces({ ...NO_PIECES, synthesizer: "elevenlabs", voiceId: "v-bia" }, READY, MODELS)).toEqual({ ...CHOICE, model: "modelo-a" });
  });

  it("a escolha gravada: a forma de `pipelineChoice`, ou nenhuma peça; e o salvar só regrava a escolha que mudou", () => {
    expect(piecesOf(CHOICE)).toEqual(CHOICE);
    expect(piecesOf(null)).toEqual(NO_PIECES);
    expect(piecesOf({ transcriber: "openai" })).toEqual(NO_PIECES);
    expect(sameChoice(CHOICE, { ...CHOICE })).toBe(true);
    expect(sameChoice(null, null)).toBe(true);
    expect(sameChoice(CHOICE, null)).toBe(false);
    expect(sameChoice(null, CHOICE)).toBe(false);
    for (const key of Object.keys(CHOICE) as (keyof typeof CHOICE)[]) expect(sameChoice(CHOICE, { ...CHOICE, [key]: "outra" })).toBe(false);
  });
});

describe("pipelineToSave: a escolha só vai no salvar quando muda", () => {
  const TWO_EARS = { ...READY, transcribers: [{ ...EAR, id: "outra" }, { ...EAR, consent: null }] };

  it("salvar outro campo com a escolha gravada não manda `pipeline`, nem esbarra numa peça que saiu da lista", () => {
    expect(pipelineToSave(true, CHOICE, CHOICE, READY, MODELS)).toEqual({ unchanged: true });
    expect(pipelineToSave(true, CHOICE, CHOICE, { ...READY, transcribers: [{ ...EAR, consent: null }] }, MODELS)).toEqual({ unchanged: true });
    expect(pipelineToSave(true, CHOICE, CHOICE, { ...READY, synthesizers: [{ ...VOICE, consent: null }] }, MODELS)).toEqual({ unchanged: true });
    expect(pipelineToSave(true, CHOICE, CHOICE, { ...READY, brains: [{ ...BRAIN, keyCheck: { result: "rejected" } }] }, MODELS)).toEqual({ unchanged: true });
    expect(pipelineToSave(true, CHOICE, CHOICE, READY, undefined)).toEqual({ unchanged: true });
  });

  it("com outra peça na lista, salvar outro campo não regrava a escolha trocada pela primeira", () => {
    expect(pipelineToSave(true, CHOICE, CHOICE, TWO_EARS, MODELS)).toEqual({ unchanged: true });
  });

  it("a escolha que mudou vai, conferida; a peça que falta segura o salvar", () => {
    expect(pipelineToSave(true, { ...CHOICE, model: "modelo-a" }, CHOICE, READY, MODELS)).toEqual({ choice: { ...CHOICE, model: "modelo-a" } });
    expect(pipelineToSave(true, { ...CHOICE, voiceId: "" }, CHOICE, READY, MODELS)).toEqual({ missing: "voice" });
    expect(pipelineToSave(true, CHOICE, null, READY, MODELS)).toEqual({ choice: CHOICE });
    expect(pipelineToSave(true, CHOICE, null, { ...READY, transcribers: [{ ...EAR, consent: null }] }, MODELS)).toEqual({ missing: "transcriber" });
  });

  it("sair do Pipeline leva `null` só quando o agente estava nele", () => {
    expect(pipelineToSave(false, CHOICE, CHOICE, READY, MODELS)).toEqual({ choice: null });
    expect(pipelineToSave(false, NO_PIECES, null, READY, MODELS)).toEqual({ unchanged: true });
  });
});

describe("as recusas do servidor ao salvar o Pipeline, na tela, nos três idiomas", () => {
  const CODES = ["pipeline_piece_unknown", "pipeline_piece_test_only", "pipeline_brain_cannot_chat", "pipeline_piece_unpriced", "pipeline_piece_unconfirmed"] as const;

  it.each([
    ["pt-BR", ptBRCommon, "o cérebro", "a voz"],
    ["en", enCommon, "the brain", "the voice"],
    ["es", esCommon, "el cerebro", "la voz"],
  ] as const)("em %s: cada código tem frase própria, com a peça do `detail` no lugar de {piece}", (_, common, brain, voice) => {
    for (const code of CODES) {
      expect(common.errors[code]).toBeTruthy();
      expect(common.errors[code]).not.toBe(common.errors.fallback);
    }
    const unpriced = withPiece(common.errors.pipeline_piece_unpriced, new ApiFailure("pipeline_piece_unpriced", "x", 422, { piece: "brain", pieceId: "openai", model: "m" }), common.pipelinePieces);
    expect(unpriced).toContain(brain);
    expect(unpriced).not.toContain("{piece}");
    const unconfirmed = withPiece(common.errors.pipeline_piece_unconfirmed, new ApiFailure("pipeline_piece_unconfirmed", "x", 422, { piece: "synthesizer", pieceId: "elevenlabs" }), common.pipelinePieces);
    expect(unconfirmed).toContain(voice);
    // Sem peça no `detail` (ou uma que o dicionário não conhece): "a peça", nunca o código.
    const bare = withPiece(common.errors.pipeline_piece_unknown, new ApiFailure("pipeline_piece_unknown", "x", 422, { piece: "peca-xyz" }), common.pipelinePieces);
    expect(bare).toContain(common.pipelinePieces.piece);
    expect(bare).not.toContain("peca-xyz");
  });
});
