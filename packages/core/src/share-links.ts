import { createHash, randomBytes } from "node:crypto";
import type { Db, OrgQuery } from "./types";
import { withSystem } from "./with-org";

/**
 * Link temporário para o titular. O token em claro só existe na resposta da criação; o banco guarda
 * o sha256 dele. Quem lê o banco não consegue montar o link, e quem tem o link não é identificado
 * por ele — a trilha fica no evento de abertura, não no token.
 */

export const SHARE_KINDS = ["recording", "export", "bundle"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** 72 h e 10 aberturas: dá tempo de o titular baixar e não deixa o link virar biblioteca. */
export const SHARE_TTL_HOURS = 72;
export const SHARE_MAX_USES = 10;

const hashOf = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface ShareLink {
  id: string;
  organizationId: string;
  callId: string | null;
  phoneE164: string | null;
  kind: ShareKind;
  expiresAt: Date;
  maxUses: number;
  uses: number;
}

interface Row {
  id: string;
  organization_id: string;
  call_id: string | null;
  phone_e164: string | null;
  kind: string;
  expires_at: Date;
  max_uses: number;
  uses: number;
}

const of = (row: Row): ShareLink => ({
  id: row.id,
  organizationId: row.organization_id,
  callId: row.call_id,
  phoneE164: row.phone_e164,
  kind: row.kind as ShareKind,
  expiresAt: row.expires_at,
  maxUses: row.max_uses,
  uses: row.uses,
});

export async function createShareLink(
  q: OrgQuery,
  options: { callId: string; kind: ShareKind; now: Date; createdBy: string | null; ttlHours?: number; maxUses?: number },
): Promise<{ token: string; expiresAt: Date; maxUses: number; path: string }> {
  const token = randomBytes(32).toString("base64url");
  const maxUses = options.maxUses ?? SHARE_MAX_USES;
  const expiresAt = new Date(options.now.getTime() + (options.ttlHours ?? SHARE_TTL_HOURS) * 60 * 60 * 1000);
  const created = await q.exec(
    "insert into share_links (organization_id, call_id, token_hash, kind, expires_at, max_uses, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [q.organizationId, options.callId, hashOf(token), options.kind, expiresAt, maxUses, options.createdBy, options.now],
  );
  if (created === 0) throw new Error("the share link was not created");
  return { token, expiresAt, maxUses, path: `/s/${token}` };
}

/** Revoga todos os links vivos de uma chamada. Devolve quantos caíram. */
export async function revokeShareLinks(q: OrgQuery, callId: string, now: Date): Promise<number> {
  return q.exec("update share_links set revoked_at = $2 where call_id = $1 and revoked_at is null", [callId, now]);
}

/**
 * Acha o link vivo pelo hash. Inválido, vencido, revogado e esgotado produzem o mesmo `null`: quem
 * sonda não descobre qual dos quatro foi. Roda em `withSystem`, porque quem abre não tem sessão.
 */
export async function shareLinkByToken(q: OrgQuery, token: string, now: Date): Promise<ShareLink | null> {
  const row = await q.one<Row>(
    "select id, organization_id, call_id, phone_e164, kind, expires_at, max_uses, uses from share_links where token_hash = $1 and revoked_at is null and expires_at > $2 and uses < max_uses",
    [hashOf(token), now],
  );
  return row ? of(row) : null;
}

/**
 * Resolve o token de um visitante sem sessão. Fica aqui porque atravessa organizações: quem abre o
 * link ainda não disse de qual organização é — o token é que diz. Fora daqui, `withSystem` é
 * proibido por cerca, e com razão.
 */
export async function resolveShareLink(db: Db, token: string, now: Date): Promise<ShareLink | null> {
  return withSystem(db, (q) => shareLinkByToken(q, token, now));
}

/** Só conta a abertura depois de o conteúdo ser servido: link que falhou não gasta uso. */
export async function consumeShareLink(q: OrgQuery, id: string): Promise<void> {
  await q.exec("update share_links set uses = uses + 1 where id = $1", [id]);
}
