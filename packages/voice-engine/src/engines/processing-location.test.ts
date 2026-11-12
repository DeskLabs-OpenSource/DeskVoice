import { describe, expect, it } from "vitest";
import { loadEngines } from "../load";
import simulated from "./simulated";

// Pela pasta, como o sistema descobre: motor novo entra no teste sem ser listado aqui.
const engines = [...(await loadEngines()).values()];

describe("o motor de voz declara onde o áudio é processado", () => {
  it("todo motor diz quem processa e onde", () => {
    for (const engine of engines) {
      expect(engine.provider.length, `${engine.id} sem provedor`).toBeGreaterThan(0);
      expect(["this-server", "undeclared", "country"], `${engine.id} sem lugar de processamento`).toContain(engine.processingLocation.kind);
    }
  });

  it("país declarado exige fonte com endereço e data", () => {
    for (const engine of engines) {
      const location = engine.processingLocation;
      if (location.kind !== "country") continue;
      expect(location.country.length, `${engine.id} declara país vazio`).toBeGreaterThan(0);
      expect(location.source.url, `${engine.id} sem URL da fonte`).toMatch(/^https:\/\//);
      expect(location.source.checkedOn, `${engine.id} com fonte sem data`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("o simulado roda neste servidor e não chama provedor", () => {
    expect(simulated.processingLocation).toEqual({ kind: "this-server" });
    expect(simulated.provider).toBe("none");
  });
});
