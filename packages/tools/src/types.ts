import type { ApprovalOutcome, Clock, OrgQuery } from "@deskvoice/core";
import type { ZodType } from "zod";

export interface ToolContext {
  organizationId: string;
  callId: string;
  agentId: string;
  q: OrgQuery;
  clock: Clock;
  telephony: {
    transfer(toE164: string): Promise<void>;
    /** Com `farewell`, o agente fala a despedida e só então a ligação cai. */
    hangup(farewell?: string): Promise<void>;
  };
  /** Faz o agente dizer algo enquanto a ferramenta trabalha ("um instante, estou conferindo"). */
  say(text: string): void;
  waitForApproval(approvalId: string, timeoutMs: number): Promise<ApprovalOutcome>;
}

export interface ToolResult {
  ok: boolean;
  /** Texto devolvido ao modelo: o que aconteceu e o que ele deve dizer a quem está na linha. */
  message: string;
  data?: unknown;
}

export interface Tool<Input = unknown> {
  name: string;
  description: string;
  /** JSON Schema entregue ao motor de voz. */
  parameters: Record<string, unknown>;
  inputSchema: ZodType<Input>;
  /**
   * Os argumentos são texto sobre quem ligou (o título de uma pendência, uma nota). Com `true`,
   * `tool_called` não os grava: o texto mora só onde o prazo de guarda o alcança (registro 0014).
   */
  personalTextArgs?: boolean;
  run(input: Input, ctx: ToolContext): Promise<ToolResult>;
}
