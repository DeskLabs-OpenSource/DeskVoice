// A linha "Testes" na tela de Custos (fatia 7c): o custo dos testes do agente sai com nome próprio,
// e não como mais um tanto do motor nas ligações.
import { describe, expect, it } from "vitest";
import en from "../../../i18n/en/costs";
import es from "../../../i18n/es/costs";
import ptBR from "../../../i18n/pt-BR/costs";
import type { Costs } from "../../../ui/types";
import { engineRowLabel, engineRowNote } from "./engine-row";

type Row = Costs["byEngine"][number];
const row = (source: Row["source"], piece: Row["piece"] = null): Row => ({
  engine: "openai-realtime",
  source,
  piece,
  label: "OpenAI Realtime",
  costCents: 12,
  callSeconds: 180,
  priceCheckedOn: null,
  priceSource: null,
  unmeasuredCount: 0,
  estimatedCount: 0,
});

describe("a linha do motor na tela de Custos", () => {
  it("o teste do agente vira 'Testes · motor', sem minutos de ligação, nos três idiomas", () => {
    expect([engineRowLabel(row("test"), ptBR), engineRowNote(row("test"), ptBR)]).toEqual(["Testes · OpenAI Realtime", "Rodadas dos testes do agente, em texto"]);
    expect(engineRowLabel(row("test"), en)).toBe("Tests · OpenAI Realtime");
    expect(engineRowLabel(row("test"), es)).toBe("Pruebas · OpenAI Realtime");
  });

  it("a ligação e o analista ficam como estavam", () => {
    expect([engineRowLabel(row(null), ptBR), engineRowNote(row(null), ptBR)]).toEqual(["OpenAI Realtime", "3 min"]);
    expect([engineRowLabel(row("analyst"), ptBR), engineRowNote(row("analyst"), ptBR)]).toEqual(["Analista · OpenAI Realtime", ptBR.analystNote]);
  });

  it("a peça separada do motor (pipeline, fatia 5c) diz qual peça é, sem minutos de ligação, nos três idiomas", () => {
    const piece = { ...row(null, "transcriber"), label: "Deepgram" };
    expect([engineRowLabel(piece, ptBR), engineRowNote(piece, ptBR)]).toEqual(["Transcrição · Deepgram", ptBR.pieceNote]);
    expect(engineRowLabel(piece, en)).toBe("Transcription · Deepgram");
    expect(engineRowLabel({ ...piece, piece: "brain" }, es)).toBe("Cerebro · Deepgram");
  });
});
