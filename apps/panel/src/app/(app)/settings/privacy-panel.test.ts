import { describe as group, expect, it } from "vitest";
import en from "../../../i18n/en/privacy";
import es from "../../../i18n/es/privacy";
import ptBR from "../../../i18n/pt-BR/privacy";
import { describe, type Entry } from "./privacy-panel";

const confirmed = (provider: string): Entry => ({
  id: "1",
  at: "2026-11-17T11:00:00.000Z",
  kind: "analyst_provider_confirmed",
  actorName: null,
  payload: { analystId: "a-1", analystName: "Jev", decisionModel: "jev", provider, confirmedByName: "Ana" },
});

group("o Registro da privacidade", () => {
  it("o recibo do analista mostra o nome do fornecedor, e nunca o id gravado (R6, fatia 4)", () => {
    for (const [t, locale] of [[ptBR, "pt-BR"], [en, "en"], [es, "es"]] as const) {
      const line = describe(confirmed("typesafe"), t, locale);
      expect(line).toContain("TypeSafe");
      expect(line).not.toContain("typesafe");
      expect(line).toContain("Ana");
    }
    // Fornecedor sem nome conhecido sai como foi gravado: a tela não inventa um nome.
    expect(describe(confirmed("acme"), ptBR, "pt-BR")).toContain("acme");
  });
});
