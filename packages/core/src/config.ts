import { z } from "zod";
import type { Config } from "./types";

const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);

const secretKey = z.string().transform((value, ctx) => {
  // O instalador pode gerar com `openssl rand -hex 32` ou `-base64 32`; os dois valem.
  const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) {
    ctx.addIssue({ code: "custom", message: "must be 32 bytes in hex or base64" });
    return z.NEVER;
  }
  return key;
});

const schema = z.object({
  DATABASE_URL: z.string(),
  MIGRATION_DATABASE_URL: z.string().optional(),
  POSTGRES_PASSWORD: z.string().optional(),
  DESKVOICE_SECRET_KEY: secretKey,
  PUBLIC_URL: z.url(),
  ARI_URL: z.url().default("http://asterisk:8088"),
  ARI_APP: z.string().default("deskvoice"),
  ARI_USERNAME: z.string().default("deskvoice"),
  ARI_PASSWORD: z.string(),
  AUDIOSOCKET_PORT: port(9092),
  PANEL_PORT: port(3000),
});

/** Lê e valida a configuração. O erro nomeia cada variável com problema e nunca repete o valor. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  // Compose repassa variável não definida como texto vazio; vazio vale como ausente.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ""));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const name = String(issue.path[0]);
      return name in present ? `${name} is invalid (${issue.message})` : `${name} is missing`;
    });
    throw new Error(`Invalid configuration: ${problems.join("; ")}`);
  }
  const values = parsed.data;
  return {
    databaseUrl: values.DATABASE_URL,
    migrationDatabaseUrl: values.MIGRATION_DATABASE_URL ?? ownerUrl(values.DATABASE_URL, values.POSTGRES_PASSWORD),
    secretKey: values.DESKVOICE_SECRET_KEY,
    publicUrl: values.PUBLIC_URL,
    ariUrl: values.ARI_URL,
    ariApp: values.ARI_APP,
    ariUsername: values.ARI_USERNAME,
    ariPassword: values.ARI_PASSWORD,
    audioSocketPort: values.AUDIOSOCKET_PORT,
    panelPort: values.PANEL_PORT,
  };
}

// O dono do schema é o superusuário `postgres` da imagem oficial, com a senha que o instalador
// gerou. Sem essa senha, só resta a própria conexão da aplicação.
function ownerUrl(databaseUrl: string, postgresPassword: string | undefined): string {
  if (postgresPassword === undefined) return databaseUrl;
  const url = new URL(databaseUrl);
  url.username = "postgres";
  url.password = postgresPassword;
  return url.toString();
}
