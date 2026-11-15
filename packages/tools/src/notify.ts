import { callerHistory, enqueueTask, type CallerHistory } from "@deskvoice/core";
import { hasWhatsAppConnector } from "./connectors/whatsapp";
import type { ToolContext } from "./types";

/** Texto do aviso por canal. Uma string só vale igual para os dois. */
export type NotificationBody = string | { panel: string; whatsapp: string };

/** Quantos títulos de pendência a linha de contexto do painel cita. A contagem é sempre a inteira. */
export const CONTEXT_TITLES = 3;

const times = (n: number): string => (n === 1 ? "1 vez" : `${n} vezes`);
const openFollowUps = (n: number): string => (n === 1 ? "1 pendência aberta" : `${n} pendências abertas`);
// O título é texto escrito pelo modelo: entra numa linha só, sem quebra que pareça outra parte do aviso.
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * A linha "Este número já ligou 3 vezes; 1 pendência aberta: …" que os avisos de transferência e de
 * recado ganham, para quem recebe saber que a pessoa já ligou (fatia 2 do desenho de 13/11).
 *
 * - `panel`: contagem e títulos das pendências abertas. O aviso de painel fica dentro da instalação.
 * - `whatsapp`: só as contagens. O título é texto livre escrito pelo modelo sobre a pessoa, e o
 *   WhatsApp é um canal fora da instalação: nenhum título, nota ou resumo vai por ele.
 *
 * `null` quando não há o que dizer: chamada sem número, ou número sem ligação anterior nem pendência.
 */
export function callerContextLine(history: CallerHistory | null, channel: "panel" | "whatsapp"): string | null {
  if (!history || (history.callCount === 0 && history.openFollowUpCount === 0)) return null;
  const parts: string[] = [];
  if (history.callCount > 0) parts.push(`Este número já ligou ${times(history.callCount)}`);
  if (history.openFollowUpCount > 0) {
    const count = history.callCount > 0 ? openFollowUps(history.openFollowUpCount) : `Este número tem ${openFollowUps(history.openFollowUpCount)}`;
    if (channel === "whatsapp") parts.push(count);
    else {
      const titles = history.openFollowUps.slice(0, CONTEXT_TITLES).map((followUp) => oneLine(followUp.title));
      const more = history.openFollowUpCount - titles.length;
      parts.push(`${count}: ${titles.join("; ")}${more > 0 ? `; e mais ${more}` : ""}`);
    }
  }
  return `${parts.join("; ")}.`;
}

/**
 * O aviso com a linha de contexto do número no fim, um texto por canal. Lê só o banco da organização
 * (`callerHistory`, dentro de `withOrg`); nada daqui volta ao modelo.
 */
export async function withCallerContext(ctx: ToolContext, body: string): Promise<{ panel: string; whatsapp: string }> {
  const history = await callerHistory(ctx.q, ctx.callId);
  const append = (line: string | null): string => (line ? `${body}\n\n${line}` : body);
  return { panel: append(callerContextLine(history, "panel")), whatsapp: append(callerContextLine(history, "whatsapp")) };
}

/**
 * Cria os avisos para os humanos da organização e enfileira a entrega de cada um. O painel recebe
 * sempre; o WhatsApp, quando pedido, se houver conector e alguém com número cadastrado.
 * Devolve os canais usados.
 */
export async function notifyHumans(ctx: ToolContext, body: NotificationBody, options: { whatsapp: boolean }): Promise<string[]> {
  const texts = typeof body === "string" ? { panel: body, whatsapp: body } : body;
  const targets: { channel: "panel" | "whatsapp"; target: string | null }[] = [{ channel: "panel", target: null }];
  if (options.whatsapp && (await hasWhatsAppConnector(ctx.q))) {
    const users = await ctx.q.many<{ whatsapp_e164: string }>(
      // Só quem está ativo: quem foi desativado saiu da equipe e não recebe mais dados de chamada.
      "select distinct whatsapp_e164 from users where organization_id = $1 and whatsapp_e164 is not null and disabled_at is null order by whatsapp_e164",
      [ctx.organizationId],
    );
    for (const user of users) targets.push({ channel: "whatsapp", target: user.whatsapp_e164 });
  }

  for (const { channel, target } of targets) {
    const row = await ctx.q.one<{ id: string }>(
      "insert into notifications (organization_id, call_id, channel, target, body, created_at) values ($1, $2, $3, $4, $5, $6) returning id",
      [ctx.organizationId, ctx.callId, channel, target, texts[channel], ctx.clock.now()],
    );
    if (!row) throw new Error(`Notification (${channel}) was not created`);
    await enqueueTask(ctx.q, { kind: "deliver_notification", payload: { notificationId: row.id }, callId: ctx.callId, runAt: ctx.clock.now() });
  }
  return [...new Set(targets.map((entry) => entry.channel))];
}
