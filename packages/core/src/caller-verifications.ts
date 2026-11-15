import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { withSystem } from "./with-org";
import type { Db, OrgQuery } from "./types";

/**
 * A prova de que quem pede a gravação é quem atendeu a ligação.
 *
 * A regra do mercado (GDPR art. 12(6), LGPD arts. 18 e 19, e o desenho do Twilio Verify) é a mesma:
 * não se prova identidade pelo que a pessoa **sabe** — nome, CPF e data de nascimento vazam e são
 * treináveis — mas pelo que ela **possui**: o número de onde a ligação partiu. O código vai para
 * esse número, e só quem o recebe consegue abrir.
 *
 * Nada aqui registra o código em claro, e nada o devolve ao chamador: só o sha256 fica na tabela.
 * A comparação é em tempo constante, e o número de tentativas é contado no banco, não na memória —
 * reiniciar o processo não zera o bloqueio.
 */

/** O código vale 5 minutos: tempo de ler a mensagem, não de madrugar sobre ele. */
export const CALLER_CODE_TTL_MS = 5 * 60 * 1000;
/** Três tentativas: um dígito perdido não bloqueia, e força bruta em 6 dígitos não cabe. */
export const CALLER_CODE_MAX_ATTEMPTS = 3;
/** Depois de confirmado, o áudio pode ser aberto por 15 minutos (o titular pode querer reouvir). */
export const CALLER_ACCESS_TTL_MS = 15 * 60 * 1000;

export type CallerChannel = "whatsapp" | "sms" | "call";

export type ConfirmResult = "ok" | "wrong" | "blocked" | "expired" | "not_found";

/** Seis dígitos, com zero à esquerda. `randomInt` é criptográfico — `Math.random` não seria. */
export function newCallerCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function callerCodeHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export interface CallerVerification {
  id: string;
  organizationId: string;
  callId: string;
  phoneE164: string;
  channel: CallerChannel;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  openedAt: Date | null;
}

const rowOf = (row: {
  id: string;
  organization_id: string;
  call_id: string;
  phone_e164: string;
  channel: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  verified_at: Date | null;
  opened_at: Date | null;
}): CallerVerification => ({
  id: row.id,
  organizationId: row.organization_id,
  callId: row.call_id,
  phoneE164: row.phone_e164,
  channel: row.channel as CallerChannel,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  expiresAt: row.expires_at,
  verifiedAt: row.verified_at,
  openedAt: row.opened_at,
});

/**
 * Cria a verificação e devolve o id. O código em claro só existe na memória de quem chamou — é ele
 * quem entrega ao canal (WhatsApp, SMS, ou a voz do operador na ligação).
 */
export async function createCallerVerification(
  q: OrgQuery,
  input: { callId: string; phoneE164: string; channel: CallerChannel; code: string; now: Date; createdBy: string | null },
): Promise<CallerVerification> {
  const expiresAt = new Date(input.now.getTime() + CALLER_CODE_TTL_MS);
  const row = await q.one<{
    id: string;
    organization_id: string;
    call_id: string;
    phone_e164: string;
    channel: string;
    attempts: number;
    max_attempts: number;
    expires_at: Date;
    verified_at: Date | null;
    opened_at: Date | null;
  }>(
    `insert into caller_verifications (organization_id, call_id, phone_e164, channel, code_hash, max_attempts, expires_at, created_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id, organization_id, call_id, phone_e164, channel, attempts, max_attempts, expires_at, verified_at, opened_at`,
    [q.organizationId, input.callId, input.phoneE164, input.channel, callerCodeHash(input.code), CALLER_CODE_MAX_ATTEMPTS, expiresAt, input.createdBy, input.now],
  );
  if (!row) throw new Error("Caller verification was not created");
  return rowOf(row);
}

/**
 * Confere o código. Conta a tentativa **antes** de comparar — o contador no banco é o que faz o
 * bloqueio valer para sempre, inclusive depois de reiniciar o processo.
 *
 * Trava a linha (`for update`): dois pedidos simultâneos com o mesmo código não passam os dois, e
 * duas tentativas erradas ao mesmo tempo contam as duas.
 */
export async function confirmCallerVerification(q: OrgQuery, input: { id: string; code: string; now: Date }): Promise<ConfirmResult> {
  const row = await q.one<{
    id: string;
    code_hash: string;
    attempts: number;
    max_attempts: number;
    expires_at: Date;
    verified_at: Date | null;
  }>("select id, code_hash, attempts, max_attempts, expires_at, verified_at from caller_verifications where id = $1 for update", [input.id]);
  if (!row) return "not_found";

  // Já confirmado e ainda dentro da janela de acesso: pode abrir de novo (o titular reouvindo).
  if (row.verified_at !== null) {
    return input.now.getTime() <= row.verified_at.getTime() + CALLER_ACCESS_TTL_MS ? "ok" : "expired";
  }
  if (input.now.getTime() > row.expires_at.getTime()) return "expired";
  if (row.attempts >= row.max_attempts) return "blocked";

  const expected = Buffer.from(row.code_hash, "hex");
  const given = Buffer.from(callerCodeHash(input.code), "hex");
  const matches = expected.length === given.length && timingSafeEqual(expected, given);

  if (!matches) {
    await q.exec("update caller_verifications set attempts = attempts + 1 where id = $1", [row.id]);
    return row.attempts + 1 >= row.max_attempts ? "blocked" : "wrong";
  }

  await q.exec("update caller_verifications set verified_at = $2, attempts = attempts + 1 where id = $1 and verified_at is null", [row.id, input.now]);
  return "ok";
}

/** Busca pelo id sem sessão: é o titular na página pública, que não tem organização no contexto. */
export function callerVerificationById(db: Db, id: string): Promise<CallerVerification | null> {
  return withSystem(db, async (q) => {
    const row = await q.one<{
      id: string;
      organization_id: string;
      call_id: string;
      phone_e164: string;
      channel: string;
      attempts: number;
      max_attempts: number;
      expires_at: Date;
      verified_at: Date | null;
      opened_at: Date | null;
    }>("select id, organization_id, call_id, phone_e164, channel, attempts, max_attempts, expires_at, verified_at, opened_at from caller_verifications where id = $1", [id]);
    return row ? rowOf(row) : null;
  });
}

/**
 * A verificação pode abrir o áudio agora? Confere prazo de acesso, confirmação e apagamento da
 * chamada na mesma consulta — e devolve o que a rota pública precisa para achar o arquivo.
 *
 * Mora aqui, e não na rota, porque `withSystem` é permitido só em `packages/core` (a cerca
 * `system-access-is-allowlisted`). O titular na página pública não tem organização no contexto.
 */
export function callerAudioAccessible(db: Db, id: string, now: Date): Promise<{ organizationId: string; callId: string } | null> {
  return withSystem(db, async (q) => {
    const row = await q.one<{ organization_id: string; call_id: string; verified_at: Date | null; erased_at: Date | null }>(
      `select v.organization_id, v.call_id, v.verified_at, c.erased_at
         from caller_verifications v join calls c on c.id = v.call_id
        where v.id = $1`,
      [id],
    );
    if (!row || row.verified_at === null || row.erased_at !== null) return null;
    if (now.getTime() > row.verified_at.getTime() + CALLER_ACCESS_TTL_MS) return null;
    return { organizationId: row.organization_id, callId: row.call_id };
  });
}

/** Marca a primeira abertura do áudio. Serve de comprovante: "o titular abriu às 14:10". */
export function markCallerAccessOpened(db: Db, id: string, at: Date): Promise<void> {
  return withSystem(db, async (q) => {
    await q.exec("update caller_verifications set opened_at = coalesce(opened_at, $2) where id = $1", [id, at]);
  });
}
