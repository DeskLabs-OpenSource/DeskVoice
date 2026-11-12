import { describe, expect, it } from "vitest";
import gemini from "./gemini-live";
import openai from "./openai-realtime";
import simulated from "./simulated";
import type { VoiceEngine } from "../types";

const MOTORES: VoiceEngine[] = [gemini, openai, simulated];

describe("o motor de voz declara onde o áudio é processado", () => {
  it("todo motor diz quem processa e onde", () => {
    for (const engine of MOTORES) {
      expect(engine.provedor.length, `${engine.id} sem provedor`).toBeGreaterThan(0);
      expect(engine.paisDeProcessamento.length, `${engine.id} sem lugar de processamento`).toBeGreaterThan(0);
    }
  });

  it("país declarado exige fonte com data; 'desconhecido' não finge saber", () => {
    for (const engine of MOTORES) {
      const semDono = engine.paisDeProcessamento === "desconhecido" || engine.paisDeProcessamento === "neste-servidor";
      if (semDono) {
        // Sem fonte não se declara país: "desconhecido" e "neste-servidor" não apontam para fora.
        expect(engine.fonteDoPais, `${engine.id} diz ${engine.paisDeProcessamento} e ainda assim traz fonte`).toBeNull();
        continue;
      }
      expect(engine.fonteDoPais, `${engine.id} declara ${engine.paisDeProcessamento} sem fonte`).not.toBeNull();
      expect(engine.fonteDoPais?.url, `${engine.id} sem URL da fonte`).toMatch(/^https:\/\//);
      expect(engine.fonteDoPais?.consultadoEm, `${engine.id} com fonte sem data`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("o simulado roda neste servidor e não chama provedor", () => {
    expect(simulated.paisDeProcessamento).toBe("neste-servidor");
    expect(simulated.provedor).toBe("nenhum");
  });

  it("os motores de terceiro não afirmam país sem declaração do provedor", () => {
    // Google e OpenAI não publicam uma região fixa por API padrão; se um dia declararem, este teste
    // continua valendo: o que ele impede é país inventado sem fonte.
    for (const engine of [gemini, openai]) {
      expect(["desconhecido", "neste-servidor"]).toContain(engine.paisDeProcessamento);
      expect(engine.fonteDoPais).toBeNull();
    }
  });
});
