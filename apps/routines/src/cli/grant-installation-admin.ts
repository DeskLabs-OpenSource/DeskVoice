import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createDb, grantInstallationAdmin, loadConfig, systemClock, type Clock, type Db, type GrantInstallationAdminResult } from "@deskvoice/core";
import { z } from "zod";
import { cliArgs } from "./args";

const inputSchema = z.object({ email: z.email("e-mail inválido") });

/**
 * Dá a uma conta a marca de quem administra a instalação (seção 3.2 do desenho do R8). É a saída
 * de emergência para quando ninguém mais administra.
 *
 * Só roda por linha de comando, na própria VPS: quem tem acesso ao servidor já é dono da
 * instalação, o mesmo raciocínio de `reset-password`. Não existe rota de painel para isto.
 */
export async function grantAdmin(db: Db, input: { email: string }, clock: Clock = systemClock): Promise<GrantInstallationAdminResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  return grantInstallationAdmin(db, parsed.data.email, clock.now());
}

async function main(): Promise<void> {
  const { values } = parseArgs({ args: cliArgs(), options: { email: { type: "string" } } });
  if (!values.email) throw new Error("uso: grant-installation-admin --email <e-mail>");

  const config = loadConfig(process.env);
  const db = createDb(config.databaseUrl, config.systemDatabaseUrl);
  try {
    const result = await grantAdmin(db, { email: values.email });
    if (result.granted) {
      process.stdout.write(`A conta ${values.email} passou a administrar a instalação.\n`);
    } else if (result.reason === "already_granted") {
      process.stdout.write(`A conta ${values.email} já administrava a instalação. Nada foi alterado.\n`);
      process.exitCode = 3;
    } else {
      process.stderr.write(`grant-installation-admin: não existe conta com o e-mail ${values.email}. Nada foi alterado.\n`);
      process.exitCode = 2;
    }
  } finally {
    await db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`grant-installation-admin: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
