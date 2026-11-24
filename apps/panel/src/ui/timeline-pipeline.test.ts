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
});
