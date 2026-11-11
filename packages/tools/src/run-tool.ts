import { recordEvent } from "@deskvoice/core";
import type { Tool, ToolContext, ToolResult } from "./types";

const FAILURE_MESSAGE =
  "Não consegui concluir isso agora. Diga a quem está na linha, com naturalidade, que não foi possível concluir neste momento, e ofereça outra forma de ajudar.";

/**
 * Executa uma ferramenta pedida pelo modelo e deixa o rastro na linha do tempo (`tool_called`,
 * `tool_result`). Argumento inválido e erro dentro da ferramenta voltam como `ok: false`: quem
 * está na linha nunca fica no silêncio por causa de uma exceção.
 */
export async function runTool(tool: Tool, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  await recordEvent(ctx.q, ctx.callId, "tool_called", { name: tool.name, args: rawArgs ?? null }, ctx.clock.now());

  let result: ToolResult;
  let error: string | undefined;
  const parsed = tool.inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "argumentos"}: ${issue.message}`).join("; ");
    result = { ok: false, message: `Argumentos inválidos para ${tool.name} (${problems}). Corrija os argumentos e chame a ferramenta de novo.` };
  } else {
    try {
      result = await tool.run(parsed.data, ctx);
    } catch (cause) {
      // O motivo fica no evento, para o operador; o modelo recebe só o que pode dizer em voz alta.
      error = cause instanceof Error ? cause.message : String(cause);
      result = { ok: false, message: FAILURE_MESSAGE };
    }
  }

  await recordEvent(ctx.q, ctx.callId, "tool_result", { name: tool.name, ok: result.ok, message: result.message, ...(error !== undefined && { error }) }, ctx.clock.now());
  return result;
}
