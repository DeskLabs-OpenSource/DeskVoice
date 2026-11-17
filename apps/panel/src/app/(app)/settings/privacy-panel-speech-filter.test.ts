import { describe as group, expect, it } from "vitest";
import en from "../../../i18n/en/privacy";
import es from "../../../i18n/es/privacy";
import ptBR from "../../../i18n/pt-BR/privacy";
import { describe, type Entry } from "./privacy-panel";

const receipt = (provider: string): Entry => ({
  id: "1",
  at: "2026-11-17T11:00:00.000Z",
  kind: "decision_model_provider_confirmed",
  // A pessoa saiu da equipe: o nome vem do recibo, gravado no momento.
  actorName: null,
  payload: { decisionModel: "jev", provider, confirmedByName: "Ana" },
});

group("o recibo do filtro de fala no Registro da privacidade", () => {
  it("diz quem confirmou que o filtro manda o texto da ligação para a TypeSafe, nos três idiomas", () => {
    expect(describe(receipt("typesafe"), ptBR, "pt-BR")).toBe("Ana confirmou que o filtro de fala manda o texto da ligação para TypeSafe.");
    expect(describe(receipt("typesafe"), en, "en")).toBe("Ana confirmed that the speech filter sends the call's text to TypeSafe.");
    expect(describe(receipt("typesafe"), es, "es")).toBe("Ana confirmó que el filtro de habla envía el texto de la llamada a TypeSafe.");
    // Fornecedor sem nome conhecido sai como foi gravado: a tela não inventa um nome.
    expect(describe(receipt("acme"), ptBR, "pt-BR")).toContain("para acme.");
  });
});
