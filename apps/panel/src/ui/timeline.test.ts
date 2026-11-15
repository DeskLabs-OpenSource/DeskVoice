import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ptBR from "../i18n/pt-BR/timeline";
import { Timeline } from "./timeline";

const sha256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("linha do tempo", () => {
  it("a gravação fechada mostra o tamanho e o começo da impressão digital, com a inteira à mão", () => {
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        events: [{ id: "1", kind: "recording_saved", at: "2026-11-15T12:00:00.000Z", payload: { bytes: 1_920_044, sha256 } }],
        live: false,
        agentName: "Ana",
      }),
    );
    expect(html).toContain("Gravação fechada: 1,9 MB, impressão digital 9f86d081884c…");
    expect(html).toContain(sha256);
    expect(html).not.toContain(ptBR.events.unknown);
  });

  it("a gravação fechada sem impressão digital diz que ela não pôde ser calculada, e que o áudio está salvo (issue 278)", () => {
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        events: [{ id: "1", kind: "recording_saved", at: "2026-11-15T12:00:00.000Z", payload: { bytes: 1_920_044, sha256: null } }],
        live: false,
        agentName: "Ana",
      }),
    );
    expect(html).toContain("Gravação fechada: 1,9 MB. A impressão digital não pôde ser calculada; o áudio está salvo do mesmo jeito.");
    expect(html).not.toContain("SHA-256");
    expect(html).not.toContain(ptBR.events.unknown);
  });
});
