import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

const key = randomBytes(32);

describe("secrets", () => {
  it("round-trips, including empty and non-ASCII text", () => {
    for (const plain of ["senha-do-tronco", "", "ação 🔑 ñ"]) {
      expect(decryptSecret(encryptSecret(plain, key), key)).toBe(plain);
    }
  });

  it("produces a versioned ciphertext that does not contain the plain text", () => {
    const plain = "senha-do-tronco";
    const enc = encryptSecret(plain, key);
    expect(enc).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/);
    expect(enc).not.toContain(plain);
    expect(enc).not.toContain(Buffer.from(plain).toString("base64"));
  });

  it("never produces the same ciphertext twice", () => {
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key));
  });

  it("throws with the wrong key", () => {
    const enc = encryptSecret("senha", key);
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
  });

  it("throws when the ciphertext was tampered with", () => {
    const [version, iv, tag, data] = encryptSecret("senha", key).split(":") as [string, string, string, string];
    const flipped = Buffer.from(data, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret([version, iv, tag, flipped.toString("base64")].join(":"), key)).toThrow();
  });

  it("rejects unknown formats and keys of the wrong size", () => {
    expect(() => decryptSecret("v2:a:b:c", key)).toThrow(/format/);
    expect(() => decryptSecret("senha em claro", key)).toThrow(/format/);
    expect(() => encryptSecret("x", randomBytes(16))).toThrow(/32 bytes/);
    expect(() => decryptSecret(encryptSecret("x", key), randomBytes(16))).toThrow(/32 bytes/);
  });
});
