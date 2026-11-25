import { decryptSecret, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { WEBHOOK_MAX_TIMEOUT_SECONDS, WEBHOOK_MIN_TIMEOUT_SECONDS } from "../connectors/webhook-timeout";
import { readSetting } from "../settings";

/**
 * Os servidores MCP que o operador cadastrou, por organização. Fica em `settings`, como
 * `webhooks.allowed`, mas fora do mapa genérico de configuração: só as rotas próprias o gravam, e
 * o PUT genérico responde 404 para esta chave.
 */
export const MCP_SERVERS_KEY = "mcp.servers";

/** O cabeçalho que leva o segredo, quando o servidor não diz outro. */
export const MCP_DEFAULT_HEADER = "Authorization";

/** Cabeçalhos que o cliente monta e que o segredo não pode tomar. */
const RESERVED_HEADER = /^(host|content-.*|mcp-.*)$/i;

const storedTool = z.object({
  name: z.string().min(1),
  description: z.string().max(1000),
  inputSchema: z.record(z.string(), z.unknown()),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  allowed: z.boolean(),
  writes: z.boolean(),
  needsApproval: z.boolean(),
  supported: z.boolean(),
});

const storedServer = z
  .object({
    slug: z.string().regex(/^[a-z0-9]{1,16}$/),
    label: z.string().min(1).max(60),
    url: z.url({ protocol: /^https?$/ }),
    headerName: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/)
      .refine((name) => !RESERVED_HEADER.test(name))
      .optional(),
    /** Cifrado com `encryptSecret`. */
    secret: z.string().min(1).optional(),
    timeoutSeconds: z.number().int().min(WEBHOOK_MIN_TIMEOUT_SECONDS).max(WEBHOOK_MAX_TIMEOUT_SECONDS).optional(),
    fetchedAt: z.iso.datetime({ offset: true }),
    tools: z.array(storedTool),
  })
  // Ferramenta fora do subconjunto nunca fica marcada, nem gravada por fora da tela.
  .refine((server) => server.tools.every((tool) => tool.supported || !tool.allowed));

const storedServers = z.array(storedServer).refine((servers) => new Set(servers.map((server) => server.slug)).size === servers.length);

export type McpToolSnapshot = z.infer<typeof storedTool>;

export interface RegisteredMcpServer extends Omit<z.infer<typeof storedServer>, "secret"> {
  /** Já decifrado: o valor do cabeçalho `headerName`. */
  secret?: string;
}

/** Os servidores MCP cadastrados na organização da transação. Lista gravada fora da forma é erro alto. */
export async function loadMcpServers(q: OrgQuery, secretKey: Buffer): Promise<RegisteredMcpServer[]> {
  const value = await readSetting(q, MCP_SERVERS_KEY);
  if (value === null) return [];
  const parsed = storedServers.safeParse(value);
  if (!parsed.success) throw new Error(`Setting ${MCP_SERVERS_KEY} is malformed: expected [{ slug, label, url, headerName?, secret?, timeoutSeconds?, fetchedAt, tools }] with unique slugs`);
  return parsed.data.map((server) => ({ ...server, secret: server.secret === undefined ? undefined : decryptSecret(server.secret, secretKey) }));
}
