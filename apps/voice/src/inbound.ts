import { INBOUND_LIMIT_SETTING, inboundLimitOf, recordEvent, resolveInboundRoute, toE164, withOrg, type Clock, type Db } from "@deskvoice/core";
import type { AriChannel, AriClient } from "./ari";
import type { AsteriskCalls } from "./asterisk-transport";
import { messageOf, type Logger } from "./log";
import { panelNotice } from "./panel-notice";

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

// Estourar o teto costuma vir em rajada: um aviso por janela basta. Cada recusa continua no histórico.
const LIMIT_NOTICE_EVERY_MS = 10 * 60 * 1000;
// Folga sobre o tempo máximo de chamada antes de considerar presa uma linha "em andamento".
const STUCK_CALL_SLACK_SECONDS = 120;

const NOTICE: Record<Refusal, (dialed: string, limit: number) => string> = {
  no_agent: (dialed) => `Uma ligação para ${dialed} foi recusada porque nenhum agente atende esse número. Escolha o agente do número em Linha telefônica.`,
  agent_disabled: (dialed) => `Uma ligação para ${dialed} foi recusada porque o agente desse número está desligado. Ligue o agente ou escolha outro em Linha telefônica.`,
  inbound_limit_reached: (dialed, limit) =>
    `Uma ligação para ${dialed} recebeu sinal de ocupado porque já havia ${limit} ligações recebidas em andamento, o limite definido em Configurações → Ligações. Outras recusas pelo mesmo motivo nos próximos 10 minutos aparecem só em Chamadas.`,
};

/**
 * Chamada recebida (`StasisStart` com o argumento `inbound`). Quem define a organização é o tronco
 * por onde ela chegou; o número discado só é procurado dentro dela. Com agente, cria a chamada e
 * manda o canal para o AudioSocket. Sem, recusa: desliga e, se a organização é conhecida, deixa a
 * chamada recusada e um aviso no painel.
 *
 * Também recusa, com sinal de ocupado e antes de qualquer gasto com o motor de voz, quando a
 * organização já tem no teto as ligações recebidas pela operadora em andamento.
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
    const number = route.phoneNumberId ? await q.one<{ e164: string }>("select e164 from phone_numbers where id = $1", [route.phoneNumberId]) : null;
    const agent = route.agentId ? await q.one<{ enabled: boolean }>("select enabled from agents where id = $1", [route.agentId]) : null;
    const to = number?.e164 ?? dialed;
    let refusal: Refusal | null = !agent ? "no_agent" : !agent.enabled ? "agent_disabled" : null;
    let limit = 0;
    if (!refusal) {
      // Tranca a linha da organização até a transação confirmar: duas ligações que chegam juntas
      // contam e gravam uma de cada vez, e o teto não é furado por corrida. `no key update` não
      // segura quem só cria linhas apontando para a organização.
      await q.one("select 1 as locked from organizations where id = $1 for no key update", [route.organizationId]);
      const stored = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [route.organizationId, INBOUND_LIMIT_SETTING]);
      limit = inboundLimitOf(stored?.value);
      // Só as recebidas pela operadora: a chamada pelo navegador também é `inbound`, mas nasce sem
      // número de destino e tem o teto dela (`web-calls.ts`).
      // E só as que ainda podem estar vivas: nenhuma chamada dura mais que o maior tempo máximo dos
      // agentes da organização. Linha mais velha que isso ficou presa (o processo caiu no meio, ou
      // o fim do canal não chegou) e não pode segurar vaga, senão cinco linhas presas dariam
      // ocupado a toda ligação até alguém reiniciar o processo de voz.
      const longest = await q.one<{ seconds: number }>("select coalesce(max(max_call_seconds), 600)::int as seconds from agents where organization_id = $1", [route.organizationId]);
      const alive = new Date(clock.now().getTime() - ((longest?.seconds ?? 600) + STUCK_CALL_SLACK_SECONDS) * 1000);
      const active = await q.one<{ count: number }>(
        "select count(*)::int as count from calls where organization_id = $1 and direction = 'inbound' and to_e164 is not null and status in ('ringing', 'in_progress') and started_at > $2",
        [route.organizationId, alive],
      );
      if ((active?.count ?? 0) >= limit) refusal = "inbound_limit_reached";
    }
    const call = await q.one<{ id: string }>(
      `insert into calls (organization_id, agent_id, direction, from_e164, to_e164, status, end_reason, started_at, ended_at)
       values ($1, $2, 'inbound', $3, $4, $5, $6, $7, $8) returning id`,
      [route.organizationId, route.agentId, from, to, refusal ? "refused" : "ringing", refusal, clock.now(), refusal ? clock.now() : null],
    );
    if (!call) throw new Error("Inbound call was not created");
    if (refusal) {
      const overLimit = refusal === "inbound_limit_reached";
      await recordEvent(q, call.id, "call_refused", { reason: refusal, from, to, dialed: exten, ...(overLimit && { limit }) }, clock.now());
      const noticedLately =
        overLimit &&
        (await q.one(
          `select 1 as hit from notifications n join calls c on c.organization_id = n.organization_id and c.id = n.call_id
            where n.organization_id = $1 and c.end_reason = 'inbound_limit_reached' and n.created_at > $2 limit 1`,
          [route.organizationId, new Date(clock.now().getTime() - LIMIT_NOTICE_EVERY_MS)],
        ));
      if (!noticedLately) await panelNotice(q, clock, call.id, NOTICE[refusal](to ?? "um número que este tronco não informou", limit));
    }
    return { callId: call.id, refusal };
  });

  if (outcome.refusal || !route.agentId) {
    log("info", "inbound call refused", { callId: outcome.callId, reason: outcome.refusal });
    // No teto, quem ligou recebe ocupado: é o que aconteceu, e ele sabe que pode tentar de novo.
    await ari.hangup(channel.id, outcome.refusal === "inbound_limit_reached" ? "busy" : undefined);
    return;
  }

  deps.calls.expect({ callId: outcome.callId, channelId: channel.id, organizationId: route.organizationId, agentId: route.agentId, trunkId: route.trunkId });
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
