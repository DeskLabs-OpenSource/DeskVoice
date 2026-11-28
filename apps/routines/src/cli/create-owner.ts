import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { accountExists, createDb, createMember, hashPassword, insertNewOrganization, loadConfig, recordFoundingOrganization, withSystem, type Db } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { z } from "zod";
import { cliArgs } from "./args";

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
 * Cria a organização, o dono e um agente de exemplo. A organização nasce pelo mesmo caminho da tela
 * (`insertNewOrganization`): política de saída desligada e os padrões da instalação copiados, e sem
 * padrão gravado a saída travada pela administração (convenção 14). Se for a primeira organização da
 * instalação, grava-a como a fundadora. E-mail que já tem conta não cria nada. Entrada inválida
 * (senha curta, e-mail ruim) lança erro.
 */
export async function createOwner(db: Db, input: OwnerInput, now: Date = new Date()): Promise<CreateOwnerResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  const { email, name, organization, password } = parsed.data;

  // Antes do hash, que é caro de propósito: repetir o comando não gasta um segundo à toa.
  if (await accountExists(db, email)) return { created: false, reason: "email_exists" };

  const passwordHash = await hashPassword(password);
  // As ferramentas vêm da pasta: o agente de exemplo nasce com todas as que funcionam, sem lista aqui,
  // menos as que vêm desligadas (`offByDefault`: a nota sobre quem ligou pede que alguém a marque) e as
  // que a sessão oferece sozinha (`offeredBySession`: a passagem entre agentes).
  const tools = [...(await loadTools()).values()].filter((tool) => tool.available !== false && tool.offByDefault !== true && tool.offeredBySession !== true).map((tool) => tool.name);

  return withSystem(db, async (q) => {
    const insert = async (sql: string, params: unknown[]): Promise<string> => {
      const row = await q.one<{ id: string }>(sql, params);
      if (!row) throw new Error("Insert returned no row");
      return row.id;
    };
    const organizationId = await insertNewOrganization(q, organization, now);
    // A conta e o vínculo de dono, pela função que grava os dois juntos.
    const member = await createMember(q, { organizationId, email, name, passwordHash, role: "owner" });
    // Entre a conferência acima e aqui outra execução criou a conta: lançar desfaz a organização.
    if (!member) throw new Error(`já existe uma conta com o e-mail ${email}`);
    const userId = member.userId;
    // Numa instalação nova a migration não achou organização: a primeira criada aqui é a fundadora, e
    // o dono dela administra a instalação (seção 3.2 do desenho do R8). Se a fundadora já existe,
    // nada muda: uma organização nova não dá papel na instalação a ninguém.
    await recordFoundingOrganization(q, organizationId);
    const agentId = await insert(
      "insert into agents (organization_id, name, role_label, instructions, greeting, engine, language, tools) values ($1, $2, $3, $4, $5, 'simulated', 'pt-BR', $6) returning id",
      [organizationId, EXAMPLE_AGENT.name, EXAMPLE_AGENT.roleLabel, EXAMPLE_AGENT.instructions, EXAMPLE_AGENT.greeting, tools],
    );
    return { created: true as const, organizationId, userId, agentId };
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: cliArgs(),
    options: { email: { type: "string" }, name: { type: "string" }, organization: { type: "string" }, "password-stdin": { type: "boolean" } },
  });
  if (!values.email || !values.name || !values.organization || !values["password-stdin"]) {
    throw new Error('uso: create-owner --email <e-mail> --name "<nome>" --organization "<empresa>" --password-stdin  (a senha vem pela entrada padrão, nunca por argumento)');
  }
  const password = (await text(process.stdin)).replace(/\r?\n$/, "");

  const config = loadConfig(process.env);
  const db = createDb(config.databaseUrl, config.systemDatabaseUrl);
  try {
    const result = await createOwner(db, { email: values.email, name: values.name, organization: values.organization, password });
    process.stdout.write(
      result.created
        ? `Organização "${values.organization}" criada, com ${values.email} como dono e o agente de exemplo "${EXAMPLE_AGENT.name}".\n`
        : `Já existe uma conta com o e-mail ${values.email}. Nada foi criado nem alterado.\n`,
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
