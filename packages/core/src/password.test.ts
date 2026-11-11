import { describe, expect, it } from "vitest";
import { hashPassword, hashToken, verifyPassword } from "./password";

describe("password", () => {
  it("verifies the right password and refuses the wrong one", async () => {
    const hash = await hashPassword("correta-cavalo-bateria");
    expect(hash).toMatch(/^scrypt:\d+:\d+:\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(hash).not.toContain("correta");
    expect(await verifyPassword("correta-cavalo-bateria", hash)).toBe(true);
    expect(await verifyPassword("correta-cavalo-bateriA", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts: the same password hashes differently", async () => {
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });

  it("returns false for a stored value it does not understand", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plain-text")).toBe(false);
    expect(await verifyPassword("x", "bcrypt:1:2:3:aa:bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt:abc:8:1:aa:bb")).toBe(false);
  });

  it("verifies hashes made with older cost parameters", async () => {
    // scrypt de "legacy" com N=1024, r=8, p=1 e sal "c2FsdA==" ("salt").
    const { scryptSync } = await import("node:crypto");
    const legacy = `scrypt:1024:8:1:c2FsdA==:${scryptSync("legacy", Buffer.from("salt"), 64, { N: 1024, r: 8, p: 1 }).toString("base64")}`;
    expect(await verifyPassword("legacy", legacy)).toBe(true);
    expect(await verifyPassword("other", legacy)).toBe(false);
  });
});

describe("hashToken", () => {
  it("is a stable sha256 in hex", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken("abd")).not.toBe(hashToken("abc"));
  });
});
