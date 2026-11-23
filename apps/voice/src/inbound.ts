import {
  CALL_RECORDING_SETTING,
  INBOUND_LIMIT_SETTING,
  MAX_VOICEMAIL_SECONDS,
  VOICEMAIL_ENABLED_SETTING,
  VOICEMAIL_LANGUAGE_SETTING,
  VOICEMAIL_MAX_SECONDS_SETTING,
  callRecordingOf,
  inboundLimitOf,
  loadIvrMenu,
  organizationSuspended,
  recordEvent,
  SPEND_CAP_REACHED,
  spendCapReached,
  resolveInboundRoute,
  spokenLanguageOf,
  toE164,
  voicemailEnabledOf,
  voicemailLanguageOf,
  voicemailMaxSecondsOf,
  withOrg,
  type Clock,
  type Db,
  type OrgQuery,
} from "@deskvoice/core";
import type { AriChannel, AriClient } from "./ari";
import type { AsteriskCalls } from "./asterisk-transport";
import { messageOf, type Logger } from "./log";
import type { IvrJob } from "./ivr-session";
import { panelNotice } from "./panel-notice";
import type { UnavailableJob } from "./unavailable";
import { BEFORE_MESSAGE_MS, type VoicemailJob, type VoicemailReason } from "./voicemail";

export interface InboundDeps {
  db: Db;
  ari: AriClient;
  clock: Clock;
  calls: AsteriskCalls;
  log: Logger;
}

// O canal chega como `PJSIP/trunk-<uuid do tronco>-<sufixo>`: `trunks.ts` cria o endpoint com esse nome.
const TRUNK_CHANNEL = /^PJSIP\/trunk-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i;

type Refusal = "no_agent" | "agent_disabled" | "inbound_limit_reached";

/**
 * Os motivos em que a chamada não tem quem atenda e o recado pode entrar. O teto de conversas
 * simultâneas fica de fora: lá há agente, e o problema é quantidade de chamadas.
 */
const VOICEMAIL_REASONS: ReadonlyArray<VoicemailReason> = ["no_agent", "agent_disabled"];
const acceptsVoicemail = (refusal: Refusal | null): refusal is VoicemailReason => refusal !== null && (VOICEMAIL_REASONS as readonly string[]).includes(refusal);

// Estourar o teto costuma vir em rajada: um aviso por janela basta. Cada recusa continua no histórico.
const LIMIT_NOTICE_EVERY_MS = 10 * 60 * 1000;
// Folga sobre o tempo máximo de chamada antes de considerar presa uma linha "em andamento".
const STUCK_CALL_SLACK_SECONDS = 120;

/**
 * O aviso do teto de gasto do mês (fatia 7c), igual pela operadora e pelo WhatsApp. O teto e o gasto
 * são em dólar, a moeda do extrato (`usage_ledger`), como na tela de Custos.
 */
export const SPEND_CAP_NOTICE = (dialed: string, capCents: number): string =>
  `Uma ligação para ${dialed} foi recusada porque esta organização chegou ao teto de gasto do mês, de US$ ${(capCents / 100).toFixed(2)}. O gasto do mês é aproximado: inclui custo estimado e não inclui o que não pôde ser medido. Quem administra a instalação pode mudar o teto. Outras recusas pelo mesmo motivo nos próximos 10 minutos aparecem só em Chamadas.`;

const VOICEMAIL_LIMIT_NOTICE = (dialed: string, limit: number): string =>
  `Uma ligação para ${dialed} recebeu sinal de ocupado porque já havia ${limit} recados sendo gravados ao mesmo tempo, o limite de ligações simultâneas definido em Configurações → Ligações. Outras recusas pelo mesmo motivo nos próximos 10 minutos aparecem só em Chamadas.`;

const NOTICE: Record<Refusal, (dialed: string, limit: number) => string> = {
  no_agent: (dialed) => `Uma ligação para ${dialed} foi recusada porque nenhum agente atende esse número. Escolha o agente do número em Linha telefônica.`,
  agent_disabled: (dialed) => `Uma ligação para ${dialed} foi recusada porque o agente desse número está desligado. Ligue o agente ou escolha outro em Linha telefônica.`,
  inbound_limit_reached: (dialed, limit) =>
    `Uma ligação para ${dialed} recebeu sinal de ocupado porque já havia ${limit} ligações recebidas em andamento, o limite definido em Configurações → Ligações. Outras recusas pelo mesmo motivo nos próximos 10 minutos aparecem só em Chamadas.`,
};

/**
 * Confere o teto de ligações recebidas, dentro da transação de quem vai criar a chamada. Vale para
 * as que chegam pela operadora e pelo WhatsApp: as duas contam juntas, no mesmo teto.
 *
 * Conversas e recados contam cada um no seu (decisão 0018, escolha 3A): o recado não gasta IA e não
 * tira a vaga de uma conversa, e os recados ao mesmo tempo têm o mesmo número como limite próprio,
 * para uma rajada para um número sem agente não abrir um canal de áudio e um arquivo por chamada.
 */
export async function inboundLimitReached(q: OrgQuery, clock: Clock, kind: "conversation" | "voicemail" = "conversation"): Promise<{ reached: boolean; limit: number }> {
  // Tranca a linha da organização até a transação confirmar: duas ligações que chegam juntas
  // contam e gravam uma de cada vez, e o teto não é furado por corrida. `no key update` não
  // segura quem só cria linhas apontando para a organização.
  await q.one("select 1 as locked from organizations where id = $1 for no key update", [q.organizationId]);
  const stored = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [q.organizationId, INBOUND_LIMIT_SETTING]);
  const limit = inboundLimitOf(stored?.value);
  // Só as recebidas pela operadora e pelo WhatsApp: a chamada pelo navegador também é `inbound`,
  // mas nasce sem número de destino e tem o teto dela (`web-calls.ts`).
  // E só as que ainda podem estar vivas: nenhuma chamada dura mais que o maior tempo máximo dos
  // agentes da organização. Linha mais velha que isso ficou presa (o processo caiu no meio, ou
  // o fim do canal não chegou) e não pode segurar vaga, senão cinco linhas presas dariam
  // ocupado a toda ligação até alguém reiniciar o processo de voz.
  // O recado não tem agente que o limite: a vida dele vem do próprio recado, o atendimento e o aviso
  // mais o maior tempo máximo que o operador pode gravar.
  const longest =
    kind === "voicemail"
      ? BEFORE_MESSAGE_MS / 1000 + MAX_VOICEMAIL_SECONDS
      : ((await q.one<{ seconds: number }>("select coalesce(max(max_call_seconds), 600)::int as seconds from agents where organization_id = $1", [q.organizationId]))?.seconds ?? 600);
  const alive = new Date(clock.now().getTime() - (longest + STUCK_CALL_SLACK_SECONDS) * 1000);
  const active = await q.one<{ count: number }>(
    "select count(*)::int as count from calls where organization_id = $1 and direction = 'inbound' and to_e164 is not null and status in ('ringing', 'in_progress') and started_at > $2 and voicemail = $3",
    [q.organizationId, alive, kind === "voicemail"],
  );
  return { reached: (active?.count ?? 0) >= limit, limit };
}

/**
 * Já houve aviso de teto atingido nos últimos 10 minutos: estourar o teto costuma vir em rajada. Cada
 * teto conta pelo `end_reason` dele: o aviso de um não cala o do outro.
 */
export async function limitNoticedLately(q: OrgQuery, clock: Clock, reason: "inbound_limit_reached" | typeof SPEND_CAP_REACHED = "inbound_limit_reached"): Promise<boolean> {
  const hit = await q.one(
    `select 1 as hit from notifications n join calls c on c.organization_id = n.organization_id and c.id = n.call_id
      where n.organization_id = $1 and c.end_reason = $3 and n.created_at > $2 limit 1`,
    [q.organizationId, new Date(clock.now().getTime() - LIMIT_NOTICE_EVERY_MS), reason],
  );
  return hit !== null;
}

/**
 * Chamada recebida (`StasisStart` com o argumento `inbound`). Quem define a organização é o tronco
 * por onde ela chegou; o número discado só é procurado dentro dela. Com agente, cria a chamada e
 * manda o canal para o AudioSocket. Sem, recusa: desliga e, se a organização é conhecida, deixa a
 * chamada recusada e um aviso no painel. Com a caixa postal e a gravação ligadas, a chamada sem quem
 * atenda também vai para o AudioSocket, marcada como recado (`voicemail.ts`).
 *
 * Também recusa, com sinal de ocupado e antes de qualquer gasto com o motor de voz, quando a
 * organização já tem no teto as ligações recebidas pela operadora em andamento.
 *
 * Número em `mode = 'ivr'` (o menu por teclas, #223): depois da organização suspensa e antes do
 * agente e da caixa postal. A chamada nasce `ringing`, sem agente, e conta no teto de ligações
 * recebidas como conversa; o menu vai lido daqui, com as opções e o áudio, até a URA
 * (`ivr-session.ts`). O número em `ivr` não precisa de agente, e por isso nunca cai na caixa postal
 * por falta dele.
 *
 * Organização suspensa, antes de tudo isso: a chamada nasce recusada (`organization_suspended`), e o
 * canal vai para o AudioSocket só para tocar a fala de indisponível e desligar (`unavailable.ts`).
 * Nenhum motor abre, nenhum recado grava, e o teto não conta, porque a chamada já nasce encerrada.
 *
 * Teto de gasto do mês atingido (fatia 7c), logo depois da suspensão: a mesma recusa, com
 * `spend_cap_reached`, e um aviso no painel por janela de 10 minutos. Sem caixa postal: o recado
 * também gera custo. Sem teto, nada é somado.
 */
export async function handleInbound(deps: InboundDeps, channel: AriChannel): Promise<void> {
  const { db, ari, clock, log } = deps;
  const trunkId = TRUNK_CHANNEL.exec(channel.name ?? "")?.[1]?.toLowerCase();
  const exten = channel.dialplan?.exten ?? "s";
  // Tronco de um número só manda o literal "s" no lugar dos dígitos; o que não dá para ler como
  // telefone é tratado do mesmo jeito, e a rota só sai se o tronco tiver um único número.
  const dialed = exten === "s" ? null : toE164(exten);
  const from = channel.caller?.number ? toE164(channel.caller.number) : null;

  const route = trunkId ? await resolveInboundRoute(db, trunkId, dialed) : null;
  if (!route) {
    log("error", "inbound call from a channel that is not a known trunk; refusing", { channel: channel.name, exten });
    await ari.hangup(channel.id);
    return;
  }

  const outcome = await withOrg(db, route.organizationId, async (q) => {
    const number = route.phoneNumberId
      ? await q.one<{ e164: string; mode: "ai" | "ivr"; ivr_menu_id: string | null }>("select e164, mode, ivr_menu_id from phone_numbers where id = $1", [route.phoneNumberId])
      : null;
    if (await organizationSuspended(q)) return refuseUnavailable(q, clock, route, from, number?.e164 ?? dialed, exten, "organization_suspended");
    const cap = await spendCapReached(q, clock.now());
    if (cap.reached) return refuseUnavailable(q, clock, route, from, number?.e164 ?? dialed, exten, SPEND_CAP_REACHED, cap.capCents);
    // O menu por teclas atende no lugar do agente: lido aqui, dentro da organização, de uma vez.
    const menu = number?.mode === "ivr" && number.ivr_menu_id ? await loadIvrMenu(q, number.ivr_menu_id) : null;
    const ivr: IvrJob | null = menu ? { menu } : null;
    const agent = !ivr && route.agentId ? await q.one<{ enabled: boolean }>("select enabled from agents where id = $1", [route.agentId]) : null;
    const to = number?.e164 ?? dialed;
    let refusal: Refusal | null = ivr ? null : !agent ? "no_agent" : !agent.enabled ? "agent_disabled" : null;
    let limit = 0;
    // A caixa postal só entra onde não há quem atenda, e só com ela e a gravação da organização
    // ligadas (escolha 5A). Os recados têm o teto próprio: no teto, ocupado, como a conversa.
    let voicemail: VoicemailJob | null = null;
    let voicemailOverLimit = false;
    if (acceptsVoicemail(refusal)) {
      const stored = await q.many<{ key: string; value: unknown }>("select key, value from settings where organization_id = $1 and key = any($2)", [
        route.organizationId,
        [VOICEMAIL_ENABLED_SETTING, VOICEMAIL_MAX_SECONDS_SETTING, VOICEMAIL_LANGUAGE_SETTING, CALL_RECORDING_SETTING],
      ]);
      const valueOf = (key: string): unknown => stored.find((row) => row.key === key)?.value;
      if (voicemailEnabledOf(valueOf(VOICEMAIL_ENABLED_SETTING)) && callRecordingOf(valueOf(CALL_RECORDING_SETTING))) {
        const checked = await inboundLimitReached(q, clock, "voicemail");
        limit = checked.limit;
        if (checked.reached) {
          refusal = "inbound_limit_reached";
          voicemailOverLimit = true;
        } else {
          voicemail = { reason: refusal, maxSeconds: voicemailMaxSecondsOf(valueOf(VOICEMAIL_MAX_SECONDS_SETTING)), language: voicemailLanguageOf(valueOf(VOICEMAIL_LANGUAGE_SETTING)) };
        }
      }
    }
    if (!refusal) {
      const checked = await inboundLimitReached(q, clock);
      limit = checked.limit;
      if (checked.reached) refusal = "inbound_limit_reached";
    }
    const answered = refusal === null || voicemail !== null;
    const call = await q.one<{ id: string }>(
      `insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, end_reason, started_at, ended_at, voicemail)
       values ($1, $2, 'inbound', 'phone', $3, $4, $5, $6, $7, $8, $9) returning id`,
      [route.organizationId, ivr ? null : route.agentId, from, to, answered ? "ringing" : "refused", answered ? null : refusal, clock.now(), answered ? null : clock.now(), voicemail !== null],
    );
    if (!call) throw new Error("Inbound call was not created");
    if (refusal && !voicemail) {
      const overLimit = refusal === "inbound_limit_reached";
      await recordEvent(q, call.id, "call_refused", { reason: refusal, from, to, dialed: exten, ...(overLimit && { limit }), ...(voicemailOverLimit && { voicemail: true }) }, clock.now());
      const noticedLately = overLimit && (await limitNoticedLately(q, clock));
      const dialedLabel = to ?? "um número que este tronco não informou";
      if (!noticedLately) await panelNotice(q, clock, call.id, voicemailOverLimit ? VOICEMAIL_LIMIT_NOTICE(dialedLabel, limit) : NOTICE[refusal](dialedLabel, limit));
    }
    return { callId: call.id, refusal, voicemail, ivr: refusal ? null : ivr, unavailable: null, unavailableReason: null };
  });

  if (outcome.unavailable) {
    log("info", "inbound call refused with the unavailable notice", { callId: outcome.callId, reason: outcome.unavailableReason, language: outcome.unavailable.language });
    deps.calls.expect({ callId: outcome.callId, channelId: channel.id, organizationId: route.organizationId, agentId: null, trunkId: route.trunkId, unavailable: outcome.unavailable });
    try {
      await ari.setVariable(channel.id, "AUDIOSOCKET_UUID", outcome.callId);
      await ari.continueDialplan(channel.id, "deskvoice-audio", "s");
    } catch (error) {
      log("error", "could not send the inbound channel to play the unavailable notice", { callId: outcome.callId, error: messageOf(error) });
      await ari.hangup(channel.id);
    }
    return;
  }

  if (outcome.refusal && !outcome.voicemail) {
    log("info", "inbound call refused", { callId: outcome.callId, reason: outcome.refusal });
    // No teto, quem ligou recebe ocupado: é o que aconteceu, e ele sabe que pode tentar de novo.
    await ari.hangup(channel.id, outcome.refusal === "inbound_limit_reached" ? "busy" : undefined);
    return;
  }
  if (outcome.voicemail) log("info", "inbound call goes to voicemail", { callId: outcome.callId, ...outcome.voicemail });
  if (outcome.ivr) log("info", "inbound call goes to the ivr", { callId: outcome.callId, menuId: outcome.ivr.menu.id });

  deps.calls.expect({
    callId: outcome.callId,
    channelId: channel.id,
    organizationId: route.organizationId,
    agentId: outcome.ivr ? null : route.agentId,
    trunkId: route.trunkId,
    ...(outcome.voicemail && { voicemail: outcome.voicemail }),
    ...(outcome.ivr && { ivr: outcome.ivr }),
  });
  try {
    // O dialplan abre o AudioSocket com este UUID: é ele que liga a conexão de áudio à chamada.
    await ari.setVariable(channel.id, "AUDIOSOCKET_UUID", outcome.callId);
    await ari.continueDialplan(channel.id, "deskvoice-audio", "s");
  } catch (error) {
    log("error", "could not send the inbound channel to the audio context", { callId: outcome.callId, error: messageOf(error) });
    // O canal some sem áudio: `channelDestroyed` fecha a chamada como falha.
    await ari.hangup(channel.id);
  }
}

type UnavailableReason = "organization_suspended" | typeof SPEND_CAP_REACHED;

/**
 * A recusa com a fala de indisponível: organização suspensa, ou teto de gasto do mês atingido. A
 * chamada nasce `refused`, com o evento, e leva o idioma da fala, o do agente do número (ou o padrão).
 * O agente só é lido pelo idioma: ligado ou não, não atende.
 *
 * Suspensa, sem aviso no painel: quem olharia o painel da organização suspensa é quem a suspensão tirou
 * dele. No teto, um aviso por janela de 10 minutos, com o teto (`capCents`).
 */
async function refuseUnavailable(
  q: OrgQuery,
  clock: Clock,
  route: { organizationId: string; agentId: string | null },
  from: string | null,
  to: string | null,
  exten: string,
  reason: UnavailableReason,
  capCents?: number,
): Promise<{ callId: string; refusal: null; voicemail: null; ivr: null; unavailable: UnavailableJob; unavailableReason: UnavailableReason }> {
  const agent = route.agentId ? await q.one<{ language: string | null }>("select language from agents where id = $1", [route.agentId]) : null;
  const call = await q.one<{ id: string }>(
    `insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, end_reason, started_at, ended_at)
     values ($1, $2, 'inbound', 'phone', $3, $4, 'refused', $6, $5, $5) returning id`,
    [route.organizationId, route.agentId, from, to, clock.now(), reason],
  );
  if (!call) throw new Error("Inbound call was not created");
  await recordEvent(q, call.id, "call_refused", { reason, from, to, dialed: exten, ...(capCents !== undefined && { capCents }) }, clock.now());
  if (reason === SPEND_CAP_REACHED && capCents !== undefined && !(await limitNoticedLately(q, clock, SPEND_CAP_REACHED))) {
    await panelNotice(q, clock, call.id, SPEND_CAP_NOTICE(to ?? "um número que este tronco não informou", capCents));
  }
  return { callId: call.id, refusal: null, voicemail: null, ivr: null, unavailable: { language: spokenLanguageOf(agent?.language) }, unavailableReason: reason };
}
