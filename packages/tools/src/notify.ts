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
 * O que nasceu numa chamada simulada (a ligação, a pendência) não entra nem na contagem nem nos
 * títulos: é um teste da equipe, e qualquer pessoa da equipe pode simular com o número de um cliente
 * (#291). A pendência criada pela tela, sem chamada, conta. As notas do agente nunca entram no aviso.
 *
 * `null` quando não há o que dizer: chamada sem número, ou número sem ligação anterior nem pendência
 * fora das simuladas.
 */
export function callerContextLine(history: CallerHistory | null, channel: "panel" | "whatsapp"): string | null {
  if (!history) return null;
  // A simulada é um teste da equipe, não a pessoa ligando: não entra no "já ligou".
  const called = history.callCount - history.simulatedCallCount;
  const open = history.openFollowUpCount - history.simulatedOpenFollowUpCount;
  if (called === 0 && open === 0) return null;
  const parts: string[] = [];
  if (called > 0) parts.push(`Este número já ligou ${times(called)}`);
  if (open > 0) {
    const count = called > 0 ? openFollowUps(open) : `Este número tem ${openFollowUps(open)}`;
    if (channel === "whatsapp") parts.push(count);
    else {
      // `callerHistory` traz as reais primeiro: os títulos citados nunca são de uma simulada.
      const titles = history.openFollowUps
        .filter((followUp) => !followUp.simulated)
        .slice(0, CONTEXT_TITLES)
        .map((followUp) => oneLine(followUp.title));
      const more = open - titles.length;
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
      // E só `member`: o vínculo de suporte da instalação nunca é avisado.
      "select distinct whatsapp_e164 from users where organization_id = $1 and kind = 'member' and whatsapp_e164 is not null and disabled_at is null order by whatsapp_e164",
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
