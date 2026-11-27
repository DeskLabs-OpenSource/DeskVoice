import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../core/test/helpers";
import { createFixture, eventsOf, notificationsOf } from "../test/helpers";
import { runTool } from "./run-tool";
import { TEXT_MAX } from "./text-limits";
import createTask from "./tools/create_task";
import notifyHuman from "./tools/notify_human";
import requestApproval from "./tools/request_approval";
import transferToHuman from "./tools/transfer_to_human";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const long = (n: number): string => "a".repeat(n);

const cases = [
  { tool: notifyHuman, field: "message", max: TEXT_MAX.notifyMessage, args: (text: string) => ({ message: text }) },
  { tool: requestApproval, field: "question", max: TEXT_MAX.approvalQuestion, args: (text: string) => ({ question: text, context: "Cliente antiga." }) },
  { tool: requestApproval, field: "context", max: TEXT_MAX.approvalContext, args: (text: string) => ({ question: "Posso dar desconto?", context: text }) },
  { tool: createTask, field: "details", max: TEXT_MAX.taskDetails, args: (text: string) => ({ title: "Retornar para Ana", details: text }) },
  { tool: transferToHuman, field: "reason", max: TEXT_MAX.transferReason, args: (text: string) => ({ reason: text, summary: "Ana quer falar com o financeiro." }) },
] as const;

describe("o teto de tamanho dos textos das ferramentas", () => {
  for (const { tool, field, max, args } of cases) {
    it(`${tool.name}.${field} acima de ${max} caracteres é recusado com o limite, sem cortar e sem efeito`, async () => {
      const ctx = await createFixture(app, `teto ${tool.name} ${field}`, { transferTo: "+5531999998888" });
      const result = await runTool(tool, args(long(max + 1)), ctx);

      expect(result.ok).toBe(false);
      expect(result.message).toContain(`${field}: texto longo demais, o máximo é ${max} caracteres`);
      expect(await notificationsOf(app, ctx.organizationId)).toEqual([]);
      expect(ctx.transfers).toEqual([]);
      expect(ctx.waits).toEqual([]);
      expect((await eventsOf(app, ctx.callId)).map((event) => event.kind)).toEqual(["tool_called", "tool_result"]);
    });

    it(`${tool.name} anuncia ao modelo o limite de ${field}`, () => {
      expect((tool.parameters as { properties: Record<string, { maxLength?: number }> }).properties[field]?.maxLength).toBe(max);
    });
  }

  it("notify_human com o texto no limite exato passa inteiro", async () => {
    const ctx = await createFixture(app, "teto notify no limite");
    const text = long(TEXT_MAX.notifyMessage);
    expect((await runTool(notifyHuman, { message: text }, ctx)).ok).toBe(true);
    expect((await notificationsOf(app, ctx.organizationId))[0]?.body).toBe(`Aviso: ${text}`);
  });
});
