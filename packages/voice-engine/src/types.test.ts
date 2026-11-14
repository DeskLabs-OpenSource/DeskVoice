import { describe, expect, it } from "vitest";
import { classifyBaseUrlOf, classifyDestinationOf, classifyModelOf } from "./types";

/**
 * O destino da classificação: o que o painel grava e a rotina lê para saber para onde mandar e com
 * que chave. O caso sem configuração é o que garante que quem já usa OpenAI não vê mudança nenhuma.
 */
describe("destino da classificação", () => {
  it("sem configuração não sobrescreve nada: o motor fica no endereço, no modelo e na chave dele", () => {
    for (const stored of [undefined, null, {}, { baseUrl: "", model: "" }, "texto", 42]) {
      expect(classifyDestinationOf(stored)).toEqual({ ok: true, target: {} });
    }
  });

  it("com endpoint, modelo e chave válidos repassa os dois e devolve a chave do endpoint", () => {
    expect(classifyDestinationOf({ baseUrl: "https://api.deepseek.com/v1/", model: "deepseek-chat", apiKey: "cifrada" })).toEqual({
      ok: true,
      target: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      endpointKey: "cifrada",
    });
    expect(classifyDestinationOf({ baseUrl: "  https://openrouter.ai/api/v1  ", model: " qwen/qwen3-32b ", apiKey: "cifrada" })).toMatchObject({
      target: { baseUrl: "https://openrouter.ai/api/v1", model: "qwen/qwen3-32b" },
    });
  });

  it("só o modelo, sem endpoint, fica na OpenAI com a chave do motor: não há chave do endpoint", () => {
    expect(classifyDestinationOf({ model: "llama-3.3-70b-versatile" })).toEqual({ ok: true, target: { model: "llama-3.3-70b-versatile" } });
    // Uma chave gravada sem endpoint não vai a lugar nenhum.
    expect(classifyDestinationOf({ model: "gpt-5-mini", apiKey: "cifrada" })).toEqual({ ok: true, target: { model: "gpt-5-mini" } });
  });

  it("endpoint sem a chave dele não sai: a do motor não serve", () => {
    expect(classifyDestinationOf({ baseUrl: "https://api.groq.com/openai/v1" })).toEqual({ ok: false, reason: "endpoint_key_missing" });
    expect(classifyDestinationOf({ baseUrl: "https://api.groq.com/openai/v1", apiKey: 7 })).toEqual({ ok: false, reason: "endpoint_key_missing" });
  });

  it.each([
    ["http em claro, que entregaria a chave sem cifra", "http://api.deepseek.com/v1"],
    ["usuário e senha na URL", "https://usuario:senha@api.deepseek.com/v1"],
    ["loopback", "https://127.0.0.1:8443/v1"],
    ["localhost", "https://localhost:3000/v1"],
    ["rede privada, 10/8", "https://10.1.2.3/v1"],
    ["rede privada, 172.16/12", "https://172.20.0.7/v1"],
    ["rede privada, 192.168/16", "https://192.168.1.10/v1"],
    ["CGNAT, 100.64/10", "https://100.64.0.1/v1"],
    ["link-local do metadado da nuvem", "https://169.254.169.254/latest"],
    ["IPv6 de loopback", "https://[::1]:8443/v1"],
    ["IPv6 de uso local, fd00::/8", "https://[fd00::1]/v1"],
    ["IPv6 link-local, fe80::/10", "https://[fe80::1]/v1"],
    ["IPv4 embutido em IPv6", "https://[::ffff:7f00:1]/v1"],
    ["endereço que não é URL", "api.deepseek.com/v1"],
  ])("recusa %s, e o endpoint recusado não recebe nada", (_reason, url) => {
    expect(classifyBaseUrlOf(url)).toBeUndefined();
    expect(classifyDestinationOf({ baseUrl: url, apiKey: "cifrada" })).toEqual({ ok: false, reason: "endpoint_refused" });
  });

  it.each([["deepseek-chat"], ["gpt-5-nano"], ["qwen/qwen3-32b"], ["accounts/fireworks/models/llama-v3p3-70b"]])("aceita o modelo %s", (model) => {
    expect(classifyModelOf(model)).toBe(model);
  });

  it.each([[""], ["   "], ["deepseek chat"], ["../outro-modelo"], ["-comeca-com-hifen"]])("recusa o modelo %j, que cai no padrão do motor", (model) => {
    expect(classifyModelOf(model)).toBeUndefined();
    expect(classifyDestinationOf({ model })).toEqual({ ok: true, target: {} });
  });
});
