import { recordEvent } from "@deskvoice/core";
import type { Tool, ToolContext, ToolResult } from "./types";

const FAILURE_MESSAGE =
  "Não consegui concluir isso agora. Diga a quem está na linha, com naturalidade, que não foi possível concluir neste momento, e ofereça outra forma de ajudar.";

/**
 * Quantas vezes cada ferramenta de escrita pode gastar uma vaga numa mesma ligação. Gasta a vaga toda
 * chamada que pode ter feito o efeito: o sucesso, o `ok: false` sem `noEffect` (o webhook que
 * respondeu erro já recebeu o POST) e o erro lançado, de que não se sabe o que saiu. Só volta a
 * vaga a recusa que a ferramenta marca com `noEffect`, feita antes de escrever, enviar ou chamar.
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
/** Conta tentativas: cada pedido avisa a equipe, mesmo o que é negado ou expira. */
export const MAX_REQUEST_APPROVAL_PER_CALL = 3;

export const MAX_SUCCESSFUL_CALLS_PER_CALL: Readonly<Record<string, number>> = {
  create_task: MAX_CREATE_TASK_PER_CALL,
  agenda_marcar: MAX_AGENDA_MARCAR_PER_CALL,
  agenda_remarcar: MAX_AGENDA_REMARCAR_PER_CALL,
  notify_human: MAX_NOTIFY_HUMAN_PER_CALL,
  call_webhook: MAX_CALL_WEBHOOK_PER_CALL,
  request_approval: MAX_REQUEST_APPROVAL_PER_CALL,
};

/**
 * O que este processo sabe de cada ferramenta com teto, por ligação: quantas vagas foram gastas e
 * quantas estão em curso.
 *
 * O modelo pede ferramentas em paralelo, e o `tool_result` só é gravado depois que a ferramenta
 * retorna: contar pelo banco, ou somar só depois do sucesso, deixaria todas as chamadas de um mesmo
 * turno passarem juntas pelo mesmo limite. Por isso a vaga é tomada antes de a ferramenta rodar e
 * devolvida se ela não concluir.
 *
 * O banco é lido uma vez, quando a entrada nasce, para trazer o que a ligação já fez antes dela.
 * Depois a conta é só da memória: uma vaga gasta entra em `spent` no mesmo instante em que sai de
 * `running`, e somar a leitura do banco a cada chamada contaria duas vezes ou nenhuma, conforme a
 * leitura visse ou não o `tool_result` que acabou de ser gravado. A poda é por tempo porque a
 * ligação não avisa quando termina, e nunca leva uma entrada com chamada em curso: quando a entrada
 * renasce, o último `tool_result` está gravado há um minuto e a leitura do banco é completa.
 */
const slots = new Map<string, { spent: number; running: number; at: number }>();
const FORGET_AFTER_MS = 60_000;

/**
 * Toma uma vaga de `name` nesta ligação e devolve como fechá-la (gasta ou devolvida), ou `null`
 * se o teto já foi alcançado. Entre conferir e tomar a vaga não há `await`:
 * duas chamadas paralelas nunca veem a mesma vaga livre.
 */
async function takeSlot(ctx: ToolContext, name: string, budget: number): Promise<((spent: boolean) => void) | null> {
  const now = ctx.clock.now().getTime();
  for (const [key, entry] of slots) {
    if (entry.running === 0 && now - entry.at >= FORGET_AFTER_MS) slots.delete(key);
  }
  const key = JSON.stringify([ctx.callId, name]);
  let entry = slots.get(key);
  if (entry === undefined) {
    const recorded = await ctx.q.one<{ count: string }>(
      "select count(*) as count from call_events where call_id = $1 and kind = 'tool_result' and payload->>'name' = $2 and payload->>'spent' = 'true'",
      [ctx.callId, name],
    );
    // Outra chamada paralela pode ter criado a entrada durante a leitura: vale a dela.
    entry = slots.get(key) ?? { spent: Number(recorded?.count ?? 0), running: 0, at: now };
    slots.set(key, entry);
  }
  if (entry.spent + entry.running >= budget) return null;
  entry.running += 1;
  entry.at = now;
  return (spent) => {
    entry.running -= 1;
    if (spent) entry.spent += 1;
    entry.at = ctx.clock.now().getTime();
  };
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
  let release: ((spent: boolean) => void) | undefined;
  // Na dúvida, a vaga fica gasta: só a recusa marcada com `noEffect` a devolve.
  let spent = false;
  const parsed = tool.inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "argumentos"}: ${issue.message}`).join("; ");
    result = { ok: false, message: `Argumentos inválidos para ${tool.name} (${problems}). Corrija os argumentos e chame a ferramenta de novo.` };
  } else {
    const budget = MAX_SUCCESSFUL_CALLS_PER_CALL[tool.name];
    try {
      const slot = budget === undefined ? undefined : await takeSlot(ctx, tool.name, budget);
      if (slot === null) {
        result = {
          ok: false,
          message: `Nada foi feito: nesta ligação o limite de ${budget} chamadas a ${tool.name} já foi alcançado, e este pedido não foi registrado. Diga a quem está na linha, com naturalidade, que por esta ligação não dá para registrar mais nada desse tipo, que o que foi registrado antes continua valendo, e que, se precisar, a pessoa pode ligar de novo ou aguardar o retorno da equipe. Não diga que este pedido foi tratado.`,
        };
      } else {
        release = slot;
        spent = true;
        result = await tool.run(parsed.data, ctx);
        spent = result.ok || result.noEffect !== true;
      }
    } catch (cause) {
      // O motivo fica no evento, para o operador; o modelo recebe só o que pode dizer em voz alta.
      error = cause instanceof Error ? cause.message : String(cause);
      result = { ok: false, message: FAILURE_MESSAGE };
    }
  }

  try {
    await recordEvent(ctx.q, ctx.callId, "tool_result", { name: tool.name, ok: result.ok, message: result.message, ...(error !== undefined && { error }), ...(release !== undefined && spent && { spent: true }) }, ctx.clock.now());
  } finally {
    // A vaga só fecha com o desfecho gravado: a entrada nunca é podada antes de o banco saber dele.
    // Se a gravação falhar, a vaga gasta conta assim mesmo: o efeito pode ter saído, e só a memória sabe.
    release?.(spent);
  }
  return result;
}
