import { describe, expect, it } from "vitest";
import { classifyBaseUrlOf, classifyModelOf, classifyTargetOf } from "./types";

/**
 * O alvo da classificação: o que o painel grava e a rotina repassa ao motor. O caso sem
 * configuração é o que garante que quem já usa OpenAI não vê mudança nenhuma.
 */
describe("alvo da classificação", () => {
  it("sem configuração não sobrescreve nada: o motor fica no endereço e no modelo dele", () => {
    expect(classifyTargetOf({})).toEqual({});
    expect(classifyTargetOf({ baseUrl: undefined, model: undefined })).toEqual({});
    expect(classifyTargetOf({ baseUrl: null, model: null })).toEqual({});
    expect(classifyTargetOf({ baseUrl: "", model: "" })).toEqual({});
  });

  it("com endpoint e modelo válidos repassa os dois, e o endereço vai sem a barra final", () => {
    expect(classifyTargetOf({ baseUrl: "https://api.deepseek.com/v1/", model: "deepseek-chat" })).toEqual({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    });
    expect(classifyTargetOf({ baseUrl: "  https://openrouter.ai/api/v1  ", model: " qwen/qwen3-32b " })).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
      model: "qwen/qwen3-32b",
    });
  });

  it("só um dos dois configurado repassa só ele: o outro fica no padrão do motor", () => {
    expect(classifyTargetOf({ baseUrl: "https://api.groq.com/openai/v1" })).toEqual({ baseUrl: "https://api.groq.com/openai/v1" });
    expect(classifyTargetOf({ model: "llama-3.3-70b-versatile" })).toEqual({ model: "llama-3.3-70b-versatile" });
  });

  it.each([
    ["http em claro, que entregaria a chave sem cifra", "http://api.deepseek.com/v1"],
    ["loopback", "https://127.0.0.1:8443/v1"],
    ["localhost", "https://localhost:3000/v1"],
    ["rede privada, 10/8", "https://10.1.2.3/v1"],
    ["rede privada, 172.16/12", "https://172.20.0.7/v1"],
    ["rede privada, 192.168/16", "https://192.168.1.10/v1"],
    ["link-local do metadado da nuvem", "https://169.254.169.254/latest"],
    ["IPv6 de loopback", "https://[::1]:8443/v1"],
    ["endereço que não é URL", "api.deepseek.com/v1"],
  ])("recusa %s", (_reason, url) => {
    expect(classifyBaseUrlOf(url)).toBeUndefined();
    expect(classifyTargetOf({ baseUrl: url })).toEqual({});
  });

  it.each([["deepseek-chat"], ["gpt-5-nano"], ["qwen/qwen3-32b"], ["accounts/fireworks/models/llama-v3p3-70b"]])("aceita o modelo %s", (model) => {
    expect(classifyModelOf(model)).toBe(model);
  });

  it.each([[""], ["   "], ["deepseek chat"], ["../outro-modelo"], ["-comeca-com-hifen"]])("recusa o modelo %j", (model) => {
    expect(classifyModelOf(model)).toBeUndefined();
  });

  it("valor que não é texto é ignorado, como se não estivesse gravado", () => {
    expect(classifyTargetOf({ baseUrl: 42, model: true })).toEqual({});
    expect(classifyModelOf(undefined)).toBeUndefined();
  });
});
