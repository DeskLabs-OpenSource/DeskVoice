import { describe, expect, it } from "vitest";
import en from "../i18n/en/common";
import ptBR from "../i18n/pt-BR/common";
import { limitReachedText } from "./limit-reached";

describe("limitReachedText", () => {
  it("says the count, the limit and who set it, for lines and for agents", () => {
    expect(limitReachedText("organization_limit_reached", { kind: "trunks", count: 3, limit: 3 }, ptBR.limitReached)).toBe(
      "Esta organização já tem 3 linhas telefônicas; o limite definido pela administração da instalação é 3.",
    );
    expect(limitReachedText("organization_limit_reached", { kind: "agents", count: 5, limit: 5 }, en.limitReached)).toBe(
      "This organization already has 5 agents; the limit set by the installation administration is 5.",
    );
  });

  it("leaves another code, or a refusal without the numbers, to the general sentence", () => {
    expect(limitReachedText("already_exists", { kind: "agents", count: 1, limit: 1 }, ptBR.limitReached)).toBeNull();
    expect(limitReachedText("organization_limit_reached", undefined, ptBR.limitReached)).toBeNull();
    expect(limitReachedText("organization_limit_reached", { kind: "numbers", count: 1, limit: 1 }, ptBR.limitReached)).toBeNull();
    expect(limitReachedText("organization_limit_reached", { kind: "agents", count: "1", limit: 1 }, ptBR.limitReached)).toBeNull();
  });
});
