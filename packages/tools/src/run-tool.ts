import { recordEvent } from "@deskvoice/core";
import type { Tool, ToolContext, ToolResult } from "./types";

const FAILURE_MESSAGE =
  "Não consegui concluir isso agora. Diga a quem está na linha, com naturalidade, que não foi possível concluir neste momento, e ofereça outra forma de ajudar.";

/**
 * Quantas vezes cada ferramenta de escrita pode concluir numa mesma ligação.
 *
 * Quem está na linha fala, e é o modelo que decide chamar a ferramenta: uma frase não confiável
 * ("crie vinte pendências", "avise a equipe dez vezes", "chame o webhook") vira vinte linhas no
 * banco, vinte notificações para a equipe ou vinte requisições para fora. O `send_whatsapp` já
 * tinha teto próprio desde que passou a enviar de verdade; as ferramentas abaixo não tinham teto
 * nenhum, e são justamente as que não custam nada a quem tenta abusar.
 *
 * O teto mora aqui, e não em cada ferramenta, porque o `runTool` é o único caminho pelo qual o
 * modelo alcança qualquer uma delas: ferramenta nova entra na proteção sem ninguém lembrar.
 *
 * Ficam fora do mapa: `send_whatsapp` (teto próprio de 5, com pedido de aprovação humana), as de
 * leitura (`agenda_horarios_livres`), cujo abuso não escreve nada, e as que mudam o estado da
 * ligação (`end_call`, `transfer_to_human`, `pause_recording`), que não se repetem em volume.
 */
export const MAX_CREATE_TASK_PER_CALL = 5;
export const MAX_AGENDA_MARCAR_PER_CALL = 5;
export const MAX_AGENDA_REMARCAR_PER_CALL = 5;
export const MAX_NOTIFY_HUMAN_PER_CALL = 3;
export const MAX_CALL_WEBHOOK_PER_CALL = 5;

export const MAX_SUCCESSFUL_CALLS_PER_CALL: Readonly<Record<string, number>> = {
  create_task: MAX_CREATE_TASK_PER_CALL,
  agenda_marcar: MAX_AGENDA_MARCAR_PER_CALL,
  agenda_remarcar: MAX_AGENDA_REMARCAR_PER_CALL,
  notify_human: MAX_NOTIFY_HUMAN_PER_CALL,
  call_webhook: MAX_CALL_WEBHOOK_PER_CALL,
};

/**
 * Chamadas concluídas neste processo cujo `tool_result` ainda não chegou ao banco.
 *
 * O modelo pede ferramentas em paralelo, e o `tool_result` só é gravado depois que a ferramenta
 * retorna: contar apenas o banco deixaria todas as chamadas de um mesmo turno passarem juntas pelo
 * mesmo limite. A poda é por tempo porque a ligação não avisa quando termina.
 */
const inFlight = new Map<string, { count: number; at: number }>();
const FORGET_AFTER_MS = 60_000;

function budgetKey(ctx: ToolContext, name: string): string {
  return JSON.stringify([ctx.callId, name]);
}

function noteSpent(ctx: ToolContext, name: string): void {
  const key = budgetKey(ctx, name);
  const entry = inFlight.get(key) ?? { count: 0, at: ctx.clock.now().getTime() };
  entry.count += 1;
  entry.at = ctx.clock.now().getTime();
  inFlight.set(key, entry);
}

/** Quantas vezes `name` já concluiu nesta ligação: o que o banco diz, ou o que este processo já fez. */
async function spentInCall(ctx: ToolContext, name: string): Promise<number> {
  const now = ctx.clock.now().getTime();
  for (const [key, entry] of inFlight) {
    if (now - entry.at >= FORGET_AFTER_MS) inFlight.delete(key);
  }
  const recorded = await ctx.q.one<{ count: string }>(
    "select count(*) as count from call_events where call_id = $1 and kind = 'tool_result' and payload->>'name' = $2 and payload->>'ok' = 'true'",
    [ctx.callId, name],
  );
  return Math.max(Number(recorded?.count ?? 0), inFlight.get(budgetKey(ctx, name))?.count ?? 0);
}

/** O que `tool_called` grava como argumentos: nada do texto, se a ferramenta declara que ele é pessoal. */
export function toolCalledArgs(tool: Tool | undefined, rawArgs: unknown): unknown {
  return tool?.personalTextArgs ? { omitted: "personal_text" } : (rawArgs ?? null);
}

/**
 * Executa uma ferramenta pedida pelo modelo e deixa o rastro na linha do tempo (`tool_called`,
 * `tool_result`). Argumento inválido e erro dentro da ferramenta voltam como `ok: false`: quem
 * está na linha nunca fica no silêncio por causa de uma exceção.
 */
export async function runTool(tool: Tool, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  await recordEvent(ctx.q, ctx.callId, "tool_called", { name: tool.name, args: toolCalledArgs(tool, rawArgs) }, ctx.clock.now());

  let result: ToolResult;
  let error: string | undefined;
  const parsed = tool.inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "argumentos"}: ${issue.message}`).join("; ");
    result = { ok: false, message: `Argumentos inválidos para ${tool.name} (${problems}). Corrija os argumentos e chame a ferramenta de novo.` };
  } else {
    const budget = MAX_SUCCESSFUL_CALLS_PER_CALL[tool.name];
    try {
      if (budget !== undefined && (await spentInCall(ctx, tool.name)) >= budget) {
        result = {
          ok: false,
          message: `Nada foi feito: nesta ligação o limite de ${budget} chamadas a ${tool.name} já foi alcançado. Diga a quem está na linha, com naturalidade, que isso já foi tratado, e siga a conversa sem repetir o pedido.`,
        };
      } else {
        result = await tool.run(parsed.data, ctx);
        if (result.ok && budget !== undefined) noteSpent(ctx, tool.name);
      }
    } catch (cause) {
      // O motivo fica no evento, para o operador; o modelo recebe só o que pode dizer em voz alta.
      error = cause instanceof Error ? cause.message : String(cause);
      result = { ok: false, message: FAILURE_MESSAGE };
    }
  }

  await recordEvent(ctx.q, ctx.callId, "tool_result", { name: tool.name, ok: result.ok, message: result.message, ...(error !== undefined && { error }) }, ctx.clock.now());
  return result;
}
