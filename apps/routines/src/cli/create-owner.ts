import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createDb, hashPassword, loadConfig, systemClock, withSystem, type Clock, type Db } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { z } from "zod";
import { ensureExpireApprovals } from "../routines/expire_approvals";

export const MIN_PASSWORD_LENGTH = 10;

const inputSchema = z.object({
  email: z.email("e-mail inválido"),
  name: z.string().trim().min(1, "informe o nome"),
  organization: z.string().trim().min(1, "informe o nome da organização"),
  password: z.string().min(MIN_PASSWORD_LENGTH, `a senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`),
});

export type OwnerInput = z.input<typeof inputSchema>;
export type CreateOwnerResult = { created: true; organizationId: string; userId: string; agentId: string } | { created: false; reason: "email_exists" };

const EXAMPLE_AGENT = {
  name: "Recepção",
  roleLabel: "Recepcionista",
  greeting: "Olá! Aqui é a recepção. Como posso ajudar você hoje?",
  instructions: [
    "Você é a recepcionista virtual desta empresa e atende ligações em português do Brasil.",
    "Fale de forma calma, cordial e direta, com frases curtas, como numa conversa por telefone.",
    "Descubra o que a pessoa precisa. Se souber responder, responda. Se não souber, não invente: anote o recado e avise a equipe.",
    "Se a pessoa pedir para falar com alguém, transfira a ligação. Antes de encerrar, pergunte se pode ajudar em mais alguma coisa.",
  ].join("\n"),
};

/**
 * Cria a organização, o dono, a política de ligações de saída (desligada) e um agente de exemplo.
 * E-mail já cadastrado não cria nada. Entrada inválida (senha curta, e-mail ruim) lança erro.
 */
export async function createOwner(db: Db, input: OwnerInput, clock: Clock): Promise<CreateOwnerResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  const { email, name, organization, password } = parsed.data;

  const emailTaken = (): Promise<boolean> => withSystem(db, async (q) => (await q.one("select 1 from users where email = $1", [email])) !== null);
  // Antes do hash, que é caro de propósito: repetir o comando não gasta um segundo à toa.
  if (await emailTaken()) return { created: false, reason: "email_exists" };

  const passwordHash = await hashPassword(password);
  // As ferramentas vêm da pasta: o agente de exemplo nasce com todas as da fundação, sem lista aqui.
  const tools = [...(await loadTools()).keys()];

  return withSystem(db, async (q) => {
    const insert = async (sql: string, params: unknown[]): Promise<string> => {
      const row = await q.one<{ id: string }>(sql, params);
      if (!row) throw new Error("Insert returned no row");
      return row.id;
    };
    const organizationId = await insert("insert into organizations (name) values ($1) returning id", [organization]);
    const userId = await insert("insert into users (organization_id, email, name, password_hash, role) values ($1, $2, $3, $4, 'owner') returning id", [
      organizationId,
      email,
      name,
      passwordHash,
    ]);
    await q.exec("insert into outbound_policy (organization_id, enabled) values ($1, false)", [organizationId]);
    const agentId = await insert(
      "insert into agents (organization_id, name, role_label, instructions, greeting, engine, language, tools) values ($1, $2, $3, $4, $5, 'simulated', 'pt-BR', $6) returning id",
      [organizationId, EXAMPLE_AGENT.name, EXAMPLE_AGENT.roleLabel, EXAMPLE_AGENT.instructions, EXAMPLE_AGENT.greeting, tools],
    );
    await ensureExpireApprovals(q, organizationId, clock.now());
    return { created: true as const, organizationId, userId, agentId };
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" }, organization: { type: "string" }, "password-stdin": { type: "boolean" } },
  });
  if (!values.email || !values.name || !values.organization || !values["password-stdin"]) {
    throw new Error('uso: create-owner --email <e-mail> --name "<nome>" --organization "<empresa>" --password-stdin  (a senha vem pela entrada padrão, nunca por argumento)');
  }
  const password = (await text(process.stdin)).replace(/\r?\n$/, "");

  const config = loadConfig(process.env);
  const db = createDb(config.databaseUrl, config.systemDatabaseUrl);
  try {
    const result = await createOwner(db, { email: values.email, name: values.name, organization: values.organization, password }, systemClock);
    process.stdout.write(
      result.created
        ? `Organização "${values.organization}" criada, com ${values.email} como dono e o agente de exemplo "${EXAMPLE_AGENT.name}".\n`
        : `Já existe um usuário com o e-mail ${values.email}. Nada foi criado nem alterado.\n`,
    );
  } finally {
    await db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`create-owner: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
