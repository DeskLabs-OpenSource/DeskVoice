import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Cifra com AES-256-GCM. Formato: `v1:<iv>:<tag>:<dados>`, cada parte em base64. */
export function encryptSecret(plain: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** Lança erro se a chave for outra ou se o texto cifrado tiver sido adulterado. */
export function decryptSecret(enc: string, key: Buffer): string {
  assertKey(key);
  const parts = enc.split(":");
  const [version, ivPart, tagPart, dataPart] = parts;
  if (parts.length !== 4 || version !== VERSION || ivPart === undefined || tagPart === undefined || dataPart === undefined) {
    throw new Error("Unknown secret format: expected v1:<iv>:<tag>:<data>");
  }
  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Unknown secret format: expected v1:<iv>:<tag>:<data>");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64")), decipher.final()]).toString("utf8");
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error(`Secret key must have 32 bytes, got ${key.length}`);
}
