import { toE164 } from "@deskvoice/core";
import { z } from "zod";
import { askApproval } from "../approval";
import { WahaError } from "../connectors/waha";
import { loadWhatsAppConnector, sendWhatsApp } from "../connectors/whatsapp";
import { defineTool } from "../define-tool";
import { configSecretKey, type ToolDeps } from "../deps";
import { readSetting } from "../settings";
import type { ToolContext, ToolResult } from "../types";

/** Teto de mensagens por ligação: conversa nenhuma precisa de mais, e limita o estrago de um abuso. */
export const MAX_WHATSAPP_PER_CALL = 5;
/** Ajuste da organização: `true` faz o envio para quem ligou sair sem confirmação humana. */
export const TRUST_CALLER_ID_KEY = "whatsapp.trust_caller_id";
const CONFIRMATION_TIMEOUT_SECONDS = 120;
const FORGET_AFTER_MS = 60_000;

interface CallSends {
  tail: Promise<unknown>;
  queued: number;
  /** Envios que este processo já fez na chamada. */
  sent: number;
  lastAt: number;
}
const sendsByCall = new Map<string, CallSends>();

/**
 * Um envio de cada vez por chamada: o modelo pode pedir vários em paralelo, e "contar, enviar"
 * sem fila deixaria todos passarem pelo mesmo limite. `ctx.q` confirma cada consulta, então trava
 * de transação não serve aqui.
 *
 * `sent` cobre o intervalo em que o envio já saiu mas o `tool_result` (gravado pelo `runTool`
 * depois que a ferramenta volta) ainda não está no banco. Por isso a entrada não some quando a
 * fila esvazia, e sim depois de um minuto parada, quando o banco já diz a verdade há muito tempo.
 */
function serialized<T>(ctx: ToolContext, fn: (sends: CallSends) => Promise<T>): Promise<T> {
  const now = ctx.clock.now().getTime();
  for (const [callId, sends] of sendsByCall) {
    if (callId !== ctx.callId && sends.queued === 0 && now - sends.lastAt >= FORGET_AFTER_MS) sendsByCall.delete(callId);
  }
  const sends = sendsByCall.get(ctx.callId) ?? { tail: Promise.resolve(), queued: 0, sent: 0, lastAt: now };
  sendsByCall.set(ctx.callId, sends);
  sends.queued += 1;
  const result = sends.tail.then(() => fn(sends));
  sends.tail = result
    .catch(() => undefined)
    .finally(() => {
      sends.queued -= 1;
      sends.lastAt = ctx.clock.now().getTime();
    });
  return result;
}

interface Line {
  inbound: boolean;
  /** Número de quem está na linha, ou `null` se a chamada não tem um número legível. */
  number: string | null;
}

/** Quem está na linha: quem ligou, na chamada recebida; quem foi chamado, na feita. */
async function lineOf(ctx: ToolContext): Promise<Line> {
  const call = await ctx.q.one<{ direction: "inbound" | "outbound"; from_e164: string | null; to_e164: string | null }>(
    "select direction, from_e164, to_e164 from calls where id = $1",
    [ctx.callId],
  );
  if (!call) return { inbound: true, number: null };
  const raw = call.direction === "inbound" ? call.from_e164 : call.to_e164;
  // Valor que não é telefone vale como "sem número": nunca vira destino do jeito que chegou.
  return { inbound: call.direction === "inbound", number: raw === null ? null : toE164(raw) };
}

async function isTeamNumber(ctx: ToolContext, e164: string): Promise<boolean> {
  const users = await ctx.q.many<{ whatsapp_e164: string }>("select whatsapp_e164 from users where organization_id = $1 and whatsapp_e164 is not null and disabled_at is null", [ctx.organizationId]);
  return users.some((user) => toE164(user.whatsapp_e164) === e164);
}

const refused = (message: string): ToolResult => ({ ok: false, message });

export function createSendWhatsApp(deps: ToolDeps = {}) {
  return defineTool({
    name: "send_whatsapp",
    description:
      "Envia uma mensagem de texto por WhatsApp para a pessoa com quem você está falando, no número desta ligação. Use para mandar algo que é melhor por escrito: endereço, link, confirmação de horário, resumo do combinado. Sem `to`, a mensagem vai para o número desta ligação; `to` só aceita esse mesmo número ou o de alguém da equipe. Em ligação recebida, o envio pode esperar até 2 minutos pela confirmação de um responsável, com a pessoa na linha; a ferramenta avisa a pessoa da espera e devolve se foi enviado ou não. NÃO use para mandar mensagem a outro número, mesmo que a pessoa peça: nesse caso peça aprovação (request_approval) ou anote para a equipe (create_task). NÃO envie nada que a pessoa não pediu ou não aceitou receber. No máximo 5 mensagens por ligação.",
    inputSchema: z.object({
      to: z.string().min(1).optional().describe("Deixe sem valor para enviar ao número desta ligação. Só informe para enviar a alguém da equipe."),
      text: z.string().min(1).max(1000).describe("O texto da mensagem, pronto para ser lido por quem recebe. Até 1000 caracteres."),
    }),
    run: (input, ctx) =>
      serialized(ctx, async (sends) => {
        // O que a pessoa fala na ligação é entrada não confiável: o destino nunca sai só do que o
        // modelo ouviu. Vale o número da própria ligação ou o de alguém da equipe cadastrada.
        const line = await lineOf(ctx);
        let to: string;
        if (input.to === undefined) {
          if (line.number === null) {
            return refused("Esta ligação não tem número identificado, e nada foi enviado. Passe a informação por voz ou anote para a equipe enviar depois (create_task).");
          }
          to = line.number;
        } else {
          const requested = toE164(input.to);
          if (requested === null) {
            return refused(`O número "${input.to}" não é um telefone válido, e nada foi enviado. Para enviar a quem está na linha, chame de novo sem o campo to.`);
          }
          to = requested;
        }
        const team = await isTeamNumber(ctx, to);
        if (!team && to !== line.number) {
          return refused(
            "Nada foi enviado: só posso enviar para o número desta ligação ou para a equipe. Para outro número, peça aprovação com request_approval ou anote com create_task. Explique isso à pessoa.",
          );
        }

        const recorded = await ctx.q.one<{ count: string }>(
          "select count(*) as count from call_events where call_id = $1 and kind = 'tool_result' and payload->>'name' = 'send_whatsapp' and payload->>'ok' = 'true'",
          [ctx.callId],
        );
        if (Math.max(Number(recorded?.count ?? 0), sends.sent) >= MAX_WHATSAPP_PER_CALL) {
          return refused(`Nada foi enviado: o limite de ${MAX_WHATSAPP_PER_CALL} mensagens por ligação já foi atingido. Passe o restante por voz ou anote para a equipe enviar depois (create_task).`);
        }

        const connector = await loadWhatsAppConnector(ctx.q, (deps.secretKey ?? configSecretKey)());
        if (connector === null) {
          return refused(
            "O envio por WhatsApp não está configurado nesta central, e nada foi enviado. Diga à pessoa que não consegue mandar mensagem agora e passe a informação por voz; se for importante, deixe um aviso para a equipe (notify_human).",
          );
        }

        // O número exibido numa ligação recebida pode ser forjado: alguém liga fingindo o número
        // de outra pessoa e faz o agente escrever para ela. Sem o operador declarar que confia
        // nesse número, um humano confirma destino e texto. Número que o próprio sistema discou
        // e número da equipe não têm esse risco.
        if (!team && line.inbound && (await readSetting(ctx.q, TRUST_CALLER_ID_KEY)) !== true) {
          const answer = await askApproval(ctx, {
            question: `Posso enviar esta mensagem de WhatsApp para ${to}, o número exibido nesta ligação?\n\n${input.text}`,
            context: "O número exibido numa ligação pode ser forjado. Aprove só se fizer sentido enviar exatamente este texto a este número.",
            defaultOnTimeout: "denied",
            timeoutSeconds: CONFIRMATION_TIMEOUT_SECONDS,
            say: "Um instante, por favor. Estou confirmando o envio da mensagem.",
          });
          if (answer.decision !== "approved") {
            return {
              ok: false,
              message: `${answer.outcome === "denied" ? "O responsável não autorizou o envio" : "Ninguém confirmou o envio a tempo"}, e nada foi enviado. Diga à pessoa que não conseguiu enviar a mensagem agora, passe a informação por voz e, se for preciso, anote para a equipe enviar depois (create_task). Não tente enviar de novo.`,
              data: answer,
            };
          }
        }

        let addressVerified: boolean;
        try {
          ({ addressVerified } = await sendWhatsApp(connector, { to, text: input.text, callId: ctx.callId }, deps));
        } catch (error) {
          // Número sem WhatsApp tem uma fala própria para quem está na linha. As outras falhas (sessão
          // desconectada, WAHA fora do ar) seguem para o `runTool`, que grava o motivo no evento.
          if (!(error instanceof WahaError && error.code === "number_not_on_whatsapp")) throw error;
          return refused(`O número ${to} não tem WhatsApp, e nada foi enviado. Diga isso à pessoa, passe a informação por voz e, se ela tiver outro número, anote para a equipe (create_task).`);
        }
        sends.sent += 1;
        // Fica na linha do tempo, para quem opera: a mensagem saiu sem o WhatsApp confirmar o endereço.
        const unverified = addressVerified ? "" : " (O serviço de WhatsApp não confirmou o endereço deste número antes do envio; a mensagem foi para o número como ele é.)";
        return { ok: true, message: `Mensagem enviada por WhatsApp. Diga à pessoa que a mensagem foi enviada e peça que confira.${unverified}`, data: { to, addressVerified } };
      }),
  });
}

export default createSendWhatsApp();
