import { randomBytes } from "node:crypto";
import { hashToken } from "./password";
import type { Db, OrgQuery } from "./types";
import { withOrg, withSystem } from "./with-org";

/**
 * Link temporário para quem ligou baixar a gravação da própria chamada. O token em claro só existe
 * na resposta da criação; o banco guarda o sha256 dele. Quem lê o banco não consegue montar o link,
 * e quem tem o link não é identificado por ele: a trilha fica no evento de cada download.
 *
 * O que conta como uso: cada download do áudio gasta um. Abrir a página do link não gasta nada, para
 * que a prévia que um aplicativo de mensagem monta ao receber o link não consuma o que é do titular.
 */

/** 72 h e 10 downloads: dá tempo de o titular baixar e não deixa o link virar biblioteca. */
export const SHARE_TTL_HOURS = 72;
export const SHARE_MAX_USES = 10;

/** Um link vivo, já com a chamada que ele entrega. */
export interface LiveShare {
  id: string;
  organizationId: string;
  callId: string;
  expiresAt: Date;
  maxUses: number;
  uses: number;
  startedAt: Date;
  endedAt: Date | null;
}

/** O que a tela da chamada mostra de cada link vivo. O token não está aqui: ele não é guardado. */
export interface ShareLinkSummary {
  id: string;
  createdAt: Date;
  createdByName: string | null;
  expiresAt: Date;
  maxUses: number;
  uses: number;
}

// Vivo: não revogado, no prazo e com download sobrando. A mesma condição na consulta e na soma do uso.
const ALIVE = "revoked_at is null and expires_at > $2 and uses < max_uses";

export async function createShareLink(
  q: OrgQuery,
  options: { callId: string; now: Date; createdBy: string | null; ttlHours?: number; maxUses?: number },
): Promise<{ id: string; token: string; expiresAt: Date; maxUses: number }> {
  const token = randomBytes(32).toString("base64url");
  const maxUses = options.maxUses ?? SHARE_MAX_USES;
  const expiresAt = new Date(options.now.getTime() + (options.ttlHours ?? SHARE_TTL_HOURS) * 60 * 60 * 1000);
  const created = await q.one<{ id: string }>(
    "insert into share_links (organization_id, call_id, token_hash, kind, expires_at, max_uses, created_by, created_at) values ($1, $2, $3, 'recording', $4, $5, $6, $7) returning id",
    [q.organizationId, options.callId, hashToken(token), expiresAt, maxUses, options.createdBy, options.now],
  );
  if (!created) throw new Error("the share link was not created");
  return { id: created.id, token, expiresAt, maxUses };
}

/** Os links vivos de uma chamada, do mais novo ao mais antigo. */
export async function liveShareLinks(q: OrgQuery, callId: string, now: Date): Promise<ShareLinkSummary[]> {
  return q.many<ShareLinkSummary>(
    `select s.id, s.created_at as "createdAt", u.name as "createdByName", s.expires_at as "expiresAt", s.max_uses as "maxUses", s.uses
       from share_links s left join users u on u.id = s.created_by
      where s.call_id = $1 and s.revoked_at is null and s.expires_at > $2 and s.uses < s.max_uses
      order by s.created_at desc`,
    [callId, now],
  );
}

/** Revoga todos os links vivos de uma chamada. Devolve quantos caíram. */
export async function revokeShareLinks(q: OrgQuery, callId: string, now: Date): Promise<number> {
  return q.exec("update share_links set revoked_at = $2 where call_id = $1 and revoked_at is null", [callId, now]);
}

/**
 * Acha o link vivo de um visitante sem sessão, com a chamada que ele entrega. Inválido, vencido,
 * revogado, esgotado e chamada apagada a pedido do titular produzem o mesmo `null`: quem sonda não
 * descobre qual foi. Só a busca pelo hash atravessa organizações (`withSystem`, permitido aqui no
 * core), porque quem abre o link ainda não disse de qual organização é; a chamada já é lida com
 * `withOrg`, na organização do link. Não gasta uso.
 */
export async function findLiveShare(db: Db, token: string, now: Date): Promise<LiveShare | null> {
  const link = await withSystem(db, (q) =>
    q.one<{ id: string; organizationId: string; callId: string; expiresAt: Date; maxUses: number; uses: number }>(
      `select id, organization_id as "organizationId", call_id as "callId", expires_at as "expiresAt", max_uses as "maxUses", uses
         from share_links where token_hash = $1 and ${ALIVE}`,
      [hashToken(token), now],
    ),
  );
  if (!link) return null;
  const call = await withOrg(db, link.organizationId, (q) =>
    q.one<{ startedAt: Date; endedAt: Date | null }>(`select started_at as "startedAt", ended_at as "endedAt" from calls where id = $1 and erased_at is null`, [link.callId]),
  );
  return call ? { ...link, ...call } : null;
}

/**
 * Gasta um download, numa operação só: a conferência (vivo, chamada não apagada) e a soma vão no
 * mesmo `update`. Pedidos simultâneos esperam a trava da linha e reavaliam a condição depois dela,
 * então o limite vale sob concorrência: só passam tantos quantos sobram. `null` = não havia uso.
 */
export async function consumeShareUse(q: OrgQuery, id: string, now: Date): Promise<{ uses: number; maxUses: number } | null> {
  return q.one<{ uses: number; maxUses: number }>(
    `update share_links set uses = uses + 1
      where id = $1 and ${ALIVE}
        and exists (select 1 from calls c where c.id = share_links.call_id and c.erased_at is null)
      returning uses, max_uses as "maxUses"`,
    [id, now],
  );
}
