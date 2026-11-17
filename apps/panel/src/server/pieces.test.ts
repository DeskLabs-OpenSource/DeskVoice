import { describe, expect, it } from "vitest";
import { listTools } from "./pieces";

// A tela importa a árvore de ferramentas a frio; em máquina carregada isso passa dos 5 s padrão.
describe("listTools", { timeout: 30_000 }, () => {
  it("oferece para marcar só as ferramentas que funcionam: a agenda sem cliente não aparece", async () => {
    const names = (await listTools()).map((tool) => tool.name).sort();
    expect(names).toEqual(["call_webhook", "create_task", "end_call", "notify_human", "remember_caller_note", "request_approval", "send_dtmf", "send_whatsapp", "stop_recording", "transfer_to_human"]);
  });
});
