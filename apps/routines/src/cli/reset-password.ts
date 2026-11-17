import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { accountExists, createDb, hashPassword, loadConfig, resetAccountPassword, type Db } from "@deskvoice/core";
import { z } from "zod";
import { cliArgs } from "./args";
import { MIN_PASSWORD_LENGTH } from "./create-owner";

const inputSchema = z.object({
  email: z.email("e-mail inválido"),
  password: z.string().min(MIN_PASSWORD_LENGTH, `a senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`),
});

export type ResetPasswordInput = z.input<typeof inputSchema>;
export type ResetPasswordResult = { changed: true; sessionsClosed: number } | { changed: false; reason: "email_not_found" };

/**
 * Troca a senha da conta pelo e-mail e encerra as sessões abertas dela.
 *
 * Só roda por linha de comando, na própria VPS: quem tem acesso ao servidor já é dono da
 * instalação. Não existe rota de painel para isto de propósito (seria um caminho de tomada de
 * conta sem e-mail de confirmação, que a fundação ainda não envia).
 */
export async function resetPassword(db: Db, input: ResetPasswordInput): Promise<ResetPasswordResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  const { email, password } = parsed.data;

  // Antes do hash, que é caro de propósito.
  if (!(await accountExists(db, email))) return { changed: false, reason: "email_not_found" };

  // A senha é da conta. Sessão aberta com a senha antiga não pode sobreviver à troca: quem perdeu a
  // senha pode tê-la perdido para alguém. Caem as sessões de todos os vínculos da conta.
  const sessionsClosed = await resetAccountPassword(db, email, await hashPassword(password));
  if (sessionsClosed === null) return { changed: false, reason: "email_not_found" };
  return { changed: true, sessionsClosed };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ args: cliArgs(), options: { email: { type: "string" }, "password-stdin": { type: "boolean" } } });
  if (!values.email || !values["password-stdin"]) {
    throw new Error("uso: reset-password --email <e-mail> --password-stdin  (a senha vem pela entrada padrão, nunca por argumento)");
  }
  const password = (await text(process.stdin)).replace(/\r?\n$/, "");

  const config = loadConfig(process.env);
  const db = createDb(config.databaseUrl, config.systemDatabaseUrl);
  try {
    const result = await resetPassword(db, { email: values.email, password });
    if (!result.changed) {
      process.stderr.write(`reset-password: não existe usuário com o e-mail ${values.email}. Nada foi alterado.\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`Senha de ${values.email} trocada. Sessões encerradas: ${result.sessionsClosed}.\n`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`reset-password: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
