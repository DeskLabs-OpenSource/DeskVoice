import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const key = randomBytes(32);
const base = {
  DATABASE_URL: "postgres://deskvoice_app:app-secret@postgres:5432/deskvoice",
  SYSTEM_DATABASE_URL: "postgres://deskvoice_system:system-secret@postgres:5432/deskvoice",
  DESKVOICE_SECRET_KEY: key.toString("base64"),
  PUBLIC_URL: "https://voz.example.com",
  ARI_PASSWORD: "ari-secret",
};

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    expect(loadConfig(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      systemDatabaseUrl: base.SYSTEM_DATABASE_URL,
      migrationDatabaseUrl: undefined,
      secretKey: key,
      publicUrl: "https://voz.example.com",
      ariUrl: "http://asterisk:8088",
      ariApp: "deskvoice",
      ariUsername: "deskvoice",
      ariPassword: "ari-secret",
      audioSocketPort: 9092,
      panelPort: 3000,
    });
  });

  it("reads overrides", () => {
    const config = loadConfig({
      ...base,
      MIGRATION_DATABASE_URL: "postgres://owner:pw@db:5432/deskvoice",
      ARI_URL: "http://10.0.0.5:8088",
      ARI_APP: "other",
      ARI_USERNAME: "ari",
      AUDIOSOCKET_PORT: "9100",
      PANEL_PORT: "8080",
    });
    expect(config).toMatchObject({
      migrationDatabaseUrl: "postgres://owner:pw@db:5432/deskvoice",
      ariUrl: "http://10.0.0.5:8088",
      ariApp: "other",
      ariUsername: "ari",
      audioSocketPort: 9100,
      panelPort: 8080,
    });
  });

  it("never builds the owner connection on its own, even with POSTGRES_PASSWORD around", () => {
    expect(loadConfig({ ...base, POSTGRES_PASSWORD: "owner-secret" }).migrationDatabaseUrl).toBeUndefined();
  });

  it("does not fall back to the application connection for the system role", () => {
    expect(() => loadConfig({ ...base, SYSTEM_DATABASE_URL: "" })).toThrow(/SYSTEM_DATABASE_URL is missing/);
  });

  it("accepts the secret key in hex", () => {
    expect(loadConfig({ ...base, DESKVOICE_SECRET_KEY: key.toString("hex") }).secretKey).toEqual(key);
  });

  it("treats an empty value as absent", () => {
    expect(loadConfig({ ...base, PANEL_PORT: "", ARI_APP: "" })).toMatchObject({ panelPort: 3000, ariApp: "deskvoice" });
  });

  it.each(["DATABASE_URL", "SYSTEM_DATABASE_URL", "DESKVOICE_SECRET_KEY", "PUBLIC_URL", "ARI_PASSWORD"] as const)("names %s when it is missing", (name) => {
    const env: Record<string, string> = { ...base };
    delete env[name];
    expect(() => loadConfig(env)).toThrow(new RegExp(`${name} is missing`));
  });

  it("names every missing variable at once", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL.*SYSTEM_DATABASE_URL.*DESKVOICE_SECRET_KEY.*PUBLIC_URL.*ARI_PASSWORD/s);
  });

  it("names the variable with an invalid value, without echoing secrets", () => {
    expect(() => loadConfig({ ...base, PANEL_PORT: "abc" })).toThrow(/PANEL_PORT/);
    expect(() => loadConfig({ ...base, AUDIOSOCKET_PORT: "70000" })).toThrow(/AUDIOSOCKET_PORT/);
    expect(() => loadConfig({ ...base, PUBLIC_URL: "not a url" })).toThrow(/PUBLIC_URL/);
    const shortKey = randomBytes(8).toString("base64");
    expect(() => loadConfig({ ...base, DESKVOICE_SECRET_KEY: shortKey })).toThrow(/DESKVOICE_SECRET_KEY/);
    expect(() => loadConfig({ ...base, DESKVOICE_SECRET_KEY: shortKey })).not.toThrow(new RegExp(shortKey.replace(/[+/]/g, ".")));
  });
});
