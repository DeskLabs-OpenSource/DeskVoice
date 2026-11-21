import { describe, expect, it } from "vitest";
import { fakeLookup } from "../../test/helpers";
import { postToWebhook, webhookTimeoutMs, WEBHOOK_DEFAULT_TIMEOUT_SECONDS, WEBHOOK_MAX_TIMEOUT_SECONDS } from "./webhook";

describe("prazo do webhook", () => {
  it("vale o gravado; sem ele, o de quem chama (teste); sem nenhum, 10 s", () => {
    expect(WEBHOOK_DEFAULT_TIMEOUT_SECONDS).toBe(10);
    expect(WEBHOOK_MAX_TIMEOUT_SECONDS).toBe(30);
    expect(webhookTimeoutMs({})).toBe(10_000);
    expect(webhookTimeoutMs({}, { timeoutMs: 5 })).toBe(5);
    expect(webhookTimeoutMs({ timeoutSeconds: 25 }, { timeoutMs: 5 })).toBe(25_000);
  });

  it("postToWebhook entrega ao pedido o prazo do webhook", async () => {
    let aborted = false;
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(init.signal?.reason);
        }),
      );
    await expect(postToWebhook({ name: "x", url: "https://hook.example.com/x", timeoutSeconds: 1 }, {}, { fetch: hang, lookup: fakeLookup() })).rejects.toThrow(/within the timeout \(1000 ms\)/);
    expect(aborted).toBe(true);
  });
});
