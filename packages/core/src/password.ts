import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Custo recomendado pela OWASP para scrypt (64 MiB). Fica gravado em cada hash, então dá para
// subir depois sem invalidar as senhas antigas.
const COST = { N: 2 ** 16, r: 8, p: 2 };
const KEY_BYTES = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // O limite padrão do Node (32 MiB) é menor que a memória que este custo pede.
    scrypt(password, salt, length, { ...cost, maxmem: 256 * cost.N * cost.r }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Formato: `scrypt:<N>:<r>:<p>:<sal>:<hash>`, sal e hash em base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST, KEY_BYTES);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join(":");
}

/** Devolve `false` também para valor gravado em formato desconhecido: nunca autentica na dúvida. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltPart, hashPart] = stored.split(":");
  if (scheme !== "scrypt" || saltPart === undefined || hashPart === undefined) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (![cost.N, cost.r, cost.p].every((value) => Number.isSafeInteger(value) && value > 0)) return false;
  const expected = Buffer.from(hashPart, "base64");
  if (expected.length === 0) return false;
  const actual = await derive(password, Buffer.from(saltPart, "base64"), cost, expected.length);
  return timingSafeEqual(actual, expected);
}

/** O banco guarda só o hash do token de sessão; o token em claro fica com o navegador. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
