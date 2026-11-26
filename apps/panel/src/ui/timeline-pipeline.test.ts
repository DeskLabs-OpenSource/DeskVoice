import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import { LocaleProvider } from "../i18n/provider";
import ptBR from "../i18n/pt-BR/timeline";
import type { CallEvent } from "./types";
import { Timeline } from "./timeline";

/** A falha por peça do motor pipeline como `call-session.ts` a grava: só os códigos, nunca o texto do fornecedor. */
const failing = [
  { id: "1", kind: "pipeline_turn_failed", at: "2026-11-24T12:00:10.000Z", payload: { piece: "brain", pieceId: "openai", detail: "provider_error" } },
  { id: "2", kind: "engine_failed", at: "2026-11-24T12:00:20.000Z", payload: { engine: "pipeline", piece: "synthesizer", pieceId: "elevenlabs", detail: "no_credit" } },
  { id: "3", kind: "call_ended", at: "2026-11-24T12:00:21.000Z", payload: { status: "failed", reason: "engine_failed", costCents: 3, seconds: 21 } },
] as CallEvent[];
const refused = [
  { id: "1", kind: "call_refused", at: "2026-11-24T12:00:01.000Z", payload: { reason: "engine_refused", engine: "pipeline", piece: "transcriber", pieceId: "deepgram", detail: "rejected" } },
  { id: "2", kind: "call_refused", at: "2026-11-24T12:00:02.000Z", payload: { reason: "engine_not_configured", engine: "pipeline", piece: "synthesizer", pieceId: "elevenlabs" } },
] as CallEvent[];

const visible = (locale: "pt-BR" | "en" | "es", events: CallEvent[]): string =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(Timeline, { events, live: false, agentName: "Ana" }) }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'");

describe("linha do tempo: a falha por peça do motor pipeline (R5, fatia 3b)", () => {
  it("cada falha tem frase nos três idiomas, com a peça e o motivo, e nenhum código cru", () => {
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale, failing);
      const p = dict.events.pipeline;
      expect(html).toContain(p.turnFailed);
      expect(html).toContain(p.line.replace("{piece}", p.pieces.brain ?? "").replace("{id}", "openai").replace("{reason}", p.reasons.provider_error ?? ""));
      expect(html).toContain(p.line.replace("{piece}", p.pieces.synthesizer ?? "").replace("{id}", "elevenlabs").replace("{reason}", p.reasons.no_credit ?? ""));
      expect(html).not.toContain("provider_error");
      expect(html).not.toContain("no_credit");
      expect(html).not.toContain(dict.events.unknown);
    }
  });

  it("a recusa de abertura diz a peça e o motivo; sem motivo, a peça não está instalada", () => {
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale, refused);
      const p = dict.events.pipeline;
      expect(html).toContain(dict.reasons.engine_refused);
      expect(html).toContain(p.line.replace("{piece}", p.pieces.transcriber ?? "").replace("{id}", "deepgram").replace("{reason}", p.reasons.rejected ?? ""));
      expect(html).toContain(p.line.replace("{piece}", p.pieces.synthesizer ?? "").replace("{id}", "elevenlabs").replace("{reason}", p.notInstalled));
      expect(html).not.toContain("rejected");
    }
  });

  it("a peça sem preço (3b-2): a recusa diz o modelo, nos três idiomas, e nenhum código cru", () => {
    const unpriced = [
      { id: "1", kind: "call_refused", at: "2026-11-24T12:00:01.000Z", payload: { reason: "pipeline_piece_unpriced", engine: "pipeline", piece: "brain", pieceId: "openai", model: "gpt-sem-preco" } },
      { id: "2", kind: "engine_failed", at: "2026-11-24T12:00:02.000Z", payload: { engine: "pipeline", piece: "synthesizer", pieceId: "elevenlabs", reason: "pipeline_piece_unpriced", model: "eleven_v9" } },
      { id: "3", kind: "call_ended", at: "2026-11-24T12:00:03.000Z", payload: { status: "refused", reason: "pipeline_piece_unpriced", costCents: 0, seconds: 0 } },
    ] as CallEvent[];
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale, unpriced);
      const p = dict.events.pipeline;
      expect(html).toContain(dict.reasons.pipeline_piece_unpriced);
      expect(html).toContain(p.line.replace("{piece}", p.pieces.brain ?? "").replace("{id}", "openai").replace("{reason}", p.unpriced.replace("{model}", "gpt-sem-preco")));
      expect(html).toContain(p.line.replace("{piece}", p.pieces.synthesizer ?? "").replace("{id}", "elevenlabs").replace("{reason}", p.unpriced.replace("{model}", "eleven_v9")));
      expect(html).not.toContain("pipeline_piece_unpriced");
      expect(html).not.toContain("{model}");
      expect(html).not.toContain(p.notInstalled);
    }
  });
});

describe("linha do tempo: a voz sem a confirmação da 9.1 (fatia 5b-1)", () => {
  it("a recusa diz a peça e onde confirmar, nos três idiomas, e nenhum código cru", () => {
    const unconfirmed = [
      { id: "1", kind: "call_refused", at: "2026-11-24T12:00:01.000Z", payload: { reason: "pipeline_piece_unconfirmed", engine: "pipeline", piece: "synthesizer", pieceId: "elevenlabs" } },
      { id: "2", kind: "call_ended", at: "2026-11-24T12:00:02.000Z", payload: { status: "refused", reason: "pipeline_piece_unconfirmed", costCents: 0, seconds: 0 } },
    ] as CallEvent[];
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale, unconfirmed);
      const p = dict.events.pipeline;
      expect(html).toContain(dict.reasons.pipeline_piece_unconfirmed);
      expect(html).toContain(p.line.replace("{piece}", p.pieces.synthesizer ?? "").replace("{id}", "elevenlabs").replace("{reason}", p.unconfirmed));
      expect(html).not.toContain("pipeline_piece_unconfirmed");
      expect(html).not.toContain(p.notInstalled);
    }
  });
});

describe("linha do tempo: a peça simulada fora da configuração de teste (fatia 5c)", () => {
  it("a recusa diz a peça e que ela só serve aos testes, nos três idiomas, e nenhum código cru", () => {
    const testOnly = [
      { id: "1", kind: "call_refused", at: "2026-11-24T12:00:01.000Z", payload: { reason: "pipeline_piece_test_only", engine: "pipeline", piece: "transcriber", pieceId: "simulated" } },
      { id: "2", kind: "call_ended", at: "2026-11-24T12:00:02.000Z", payload: { status: "refused", reason: "pipeline_piece_test_only", costCents: 0, seconds: 0 } },
    ] as CallEvent[];
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale, testOnly);
      const p = dict.events.pipeline;
      expect(html).toContain(dict.reasons.pipeline_piece_test_only);
      expect(html).toContain(p.line.replace("{piece}", p.pieces.transcriber ?? "").replace("{id}", "simulated").replace("{reason}", p.testOnly));
      expect(html).not.toContain("pipeline_piece_test_only");
      expect(html).not.toContain(p.notInstalled);
    }
  });
});

describe("linha do tempo: a latência por turno e a nota da abertura do pipeline (fatia 3c-1)", () => {
  const timed = [
    {
      id: "1",
      kind: "call_answered",
      at: "2026-11-24T12:00:00.000Z",
      payload: { engine: "pipeline", opening: { transcriberMs: 150, fixedSpeechMs: 100, keyCheckMs: null, fixedSpeech: 3, fromCache: 0, totalMs: 150 } },
    },
    { id: "2", kind: "pipeline_turn_latency", at: "2026-11-24T12:00:05.000Z", payload: { endpointMs: 300, brainFirstTextMs: 500, voiceFirstAudioMs: 200, totalMs: 1000, endFromArrival: false, tool: false } },
    { id: "3", kind: "pipeline_turn_latency", at: "2026-11-24T12:00:09.000Z", payload: { endpointMs: 0, brainFirstTextMs: 500, voiceFirstAudioMs: 200, totalMs: 2250, endFromArrival: true, tool: true } },
  ] as CallEvent[];
  const cachedOpening = [
    { id: "1", kind: "call_answered", at: "2026-11-24T12:00:00.000Z", payload: { engine: "pipeline", opening: { transcriberMs: 100, fixedSpeechMs: 70, keyCheckMs: 70, fixedSpeech: 3, fromCache: 3, totalMs: 100 } } },
  ] as CallEvent[];
  const seconds = (locale: string, ms: number): string => (ms / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });

  it("cada turno diz o total e onde o tempo foi gasto, nos três idiomas; a ferramenta e o fim pela chegada têm frase", () => {
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const html = visible(locale, timed);
      const p = dict.events.pipeline;
      const line = (total: number, endpoint: number) =>
        p.latency.replace("{total}", seconds(locale, total)).replace("{endpoint}", seconds(locale, endpoint)).replace("{brain}", seconds(locale, 500)).replace("{voice}", seconds(locale, 200));
      expect(html).toContain(line(1000, 300));
      expect(html).toContain(line(2250, 0));
      // Só o segundo turno teve ferramenta e fim pela chegada.
      expect(html.split(p.latencyTool)).toHaveLength(2);
      expect(html.split(p.latencyArrival)).toHaveLength(2);
      expect(html).not.toContain("pipeline_turn_latency");
      expect(html).not.toContain("{");
      expect(html).not.toContain(dict.events.unknown);
    }
  });

  it("o atendimento do pipeline diz quanto a abertura levou, com e sem cache; sem a nota, a frase é a de sempre", () => {
    for (const [locale, dict] of [["pt-BR", ptBR], ["en", en], ["es", es]] as const) {
      const p = dict.events.pipeline;
      const fresh = visible(locale, timed);
      expect(fresh).toContain(p.opening.replace("{total}", seconds(locale, 150)).replace("{transcriber}", seconds(locale, 150)).replace("{fixed}", seconds(locale, 100)).replace("{cached}", "0").replace("{count}", "3"));
      expect(fresh).toContain(p.openingNoKey);
      const cached = visible(locale, cachedOpening);
      expect(cached).toContain(p.opening.replace("{total}", seconds(locale, 100)).replace("{transcriber}", seconds(locale, 100)).replace("{fixed}", seconds(locale, 70)).replace("{cached}", "3").replace("{count}", "3"));
      expect(cached).toContain(p.openingKey.replace("{key}", seconds(locale, 70)));
      const plain = visible(locale, [{ id: "1", kind: "call_answered", at: "2026-11-24T12:00:00.000Z", payload: { engine: "openai-realtime" } }] as CallEvent[]);
      expect(plain).toContain(dict.events.call_answered);
      expect(plain).not.toContain(p.openingNoKey);
      expect(plain).not.toContain(p.openingKey.slice(0, 12));
    }
  });
});
