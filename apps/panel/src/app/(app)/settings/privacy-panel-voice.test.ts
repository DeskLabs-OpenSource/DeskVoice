import { describe as group, expect, it } from "vitest";
import en from "../../../i18n/en/privacy";
import es from "../../../i18n/es/privacy";
import ptBR from "../../../i18n/pt-BR/privacy";
import { describe, type Entry } from "./privacy-panel";

const receipt = (provider: string): Entry => ({
  id: "1",
  at: "2026-11-17T17:30:00.000Z",
  kind: "synthesizer_provider_confirmed",
  // A pessoa saiu da equipe: o nome vem do recibo, gravado no momento.
  actorName: null,
  payload: { synthesizerId: "elevenlabs", provider, confirmedByName: "Ana" },
});

group("o recibo da voz no Registro da privacidade", () => {
  it("diz quem confirmou que a voz ElevenLabs recebe o texto que o agente fala, nos três idiomas", () => {
    expect(describe(receipt("elevenlabs"), ptBR, "pt-BR")).toBe("Ana confirmou que a voz ElevenLabs recebe o texto que o agente fala na ligação.");
    expect(describe(receipt("elevenlabs"), en, "en")).toBe("Ana confirmed that the ElevenLabs voice receives the text the agent speaks on the call.");
    expect(describe(receipt("elevenlabs"), es, "es")).toBe("Ana confirmó que la voz ElevenLabs recibe el texto que el agente dice en la llamada.");
    // Fornecedor sem nome conhecido sai como foi gravado: a tela não inventa um nome.
    expect(describe(receipt("acme"), ptBR, "pt-BR")).toContain("a voz acme recebe");
  });
});
