import { encryptSecret, withOrg, type OrgQuery } from "@deskvoice/core";
import { McpHttpError, McpProtocolError, listTools, type DiscoveredTool, type McpEndpoint, type McpToolList } from "@deskvoice/tools/mcp-client";
import { mcpToolName } from "@deskvoice/tools/mcp-schema";
import { MCP_DEFAULT_HEADER, MCP_SERVERS_KEY, loadMcpServers, type McpToolSnapshot, type RegisteredMcpServer } from "@deskvoice/tools/mcp-servers";
import { SafeFetchTimeoutError, UnsafeDestinationError } from "@deskvoice/tools/safe-fetch";
import { WEBHOOK_DEFAULT_TIMEOUT_SECONDS, WEBHOOK_MAX_TIMEOUT_SECONDS, WEBHOOK_MIN_TIMEOUT_SECONDS } from "@deskvoice/tools/webhook-timeout";
import { z } from "zod";
import { ApiError, type ServerDeps, type Session } from "./context";

/**
 * Os servidores MCP da organização pela tela (fatia 8b do item 8, spec 2026-11-22 seção 5.6). A
 * lista mora em `settings` (`mcp.servers`), fora do mapa genérico: só estas funções a gravam. Toda
 * busca no servidor sai pelo `listTools` da 8a, sem seguir redirecionamento, e fora da transação.
 */

export const MCP_SLUG = /^[a-z0-9]{1,16}$/;
const RESERVED_HEADER = /^(host|content-.*|mcp-.*)$/i;

const headerName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,64}$/)
  .refine((name) => !RESERVED_HEADER.test(name), "Host, Content-* and Mcp-* are set by the client");
const timeoutSeconds = z.number().int().min(WEBHOOK_MIN_TIMEOUT_SECONDS).max(WEBHOOK_MAX_TIMEOUT_SECONDS);
const secret = z.string().trim().min(1).max(500);
const url = z.url({ protocol: /^https?$/ }).max(500);

/** O que a descoberta recebe. `slug` é opcional: sem ele, o nome mais longo possível decide se cabe. */
export const discoverBody = z.object({
  url,
  headerName: headerName.optional(),
  secret: secret.optional(),
  timeoutSeconds: timeoutSeconds.optional(),
  slug: z.string().regex(MCP_SLUG).optional(),
});

/**
 * O que a tela grava. Das ferramentas, só o nome, a impressão digital e as marcas: a descrição e o
 * esquema vêm da busca feita aqui, nunca da tela. `confirm` igual ao `slug` autoriza desmarcar
 * ferramenta que algum agente usa. `create` marca o pedido de criação: com um `slug` que já existe na
 * organização, ele é recusado com 409 e o servidor gravado não muda.
 */
export const saveBody = z.object({
  label: z.string().trim().min(1).max(60),
  url,
  headerName: headerName.optional(),
  secret: secret.optional(),
  timeoutSeconds: timeoutSeconds.optional(),
  tools: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        allowed: z.boolean(),
        writes: z.boolean().default(true),
        // Ausente guarda a marca da ferramenta que não mudou; a ferramenta nova ou que mudou começa sem.
        needsApproval: z.boolean().optional(),
      }),
    )
    .max(200)
    .refine((tools) => new Set(tools.map((tool) => tool.name)).size === tools.length, "tool names must be unique"),
  confirm: z.string().optional(),
  create: z.boolean().optional(),
});

export const deleteBody = z.object({ confirm: z.string().optional() });

/** Um agente que usa ferramenta do servidor, pelo nome, e quais. */
export interface McpAgentUse {
  id: string;
  name: string;
  tools: string[];
}

export interface McpServerView {
  slug: string;
  label: string;
  url: string;
  headerName: string;
  secret: { configured: boolean };
  timeoutSeconds: number;
  fetchedAt: string;
  tools: McpToolSnapshot[];
  /** Os agentes da organização que usam alguma ferramenta deste servidor. */
  agents: McpAgentUse[];
}

const netOf = (deps: ServerDeps) => ({
  fetch: deps.fetch,
  lookup: deps.lookup,
});

/** A falha da busca como resposta da API. O redirecionamento leva o `Location`, para a tela mostrar. */
function lookupFailure(error: unknown): never {
  if (error instanceof McpProtocolError && error.location !== undefined)
    throw new ApiError(502, "mcp_redirect", "The server asked for another address; register the final address.", { location: error.location.slice(0, 500) });
  if (error instanceof McpHttpError) throw new ApiError(502, "mcp_http_error", `The MCP server answered HTTP ${error.status}.`, { status: error.status });
  if (error instanceof McpProtocolError) throw new ApiError(502, "mcp_protocol_error", error.message.slice(0, 300));
  if (error instanceof SafeFetchTimeoutError) throw new ApiError(504, "mcp_timeout", "The MCP server did not answer within the timeout.");
  if (error instanceof UnsafeDestinationError) throw new ApiError(400, "mcp_destination_blocked", "The address is not a public internet address.");
  throw new ApiError(502, "mcp_unreachable", "The MCP server could not be reached.");
}

/** Busca as ferramentas no servidor, pela mesma via da ligação. */
export async function lookTools(deps: ServerDeps, endpoint: McpEndpoint): Promise<McpToolList> {
  try {
    return await listTools(endpoint, netOf(deps));
  } catch (error) {
    lookupFailure(error);
  }
}

/** Os agentes da organização que usam algum nome `<slug>__*`. */
async function agentsUsing(q: OrgQuery, slug: string): Promise<McpAgentUse[]> {
  const prefix = `${slug}__`;
  const rows = await q.many<{ id: string; name: string; tools: string[] }>(
    "select id, name, array(select t from unnest(tools) t where left(t, length($1)) = $1) as tools from agents where exists (select 1 from unnest(tools) t where left(t, length($1)) = $1) order by name, id",
    [prefix],
  );
  return rows;
}

export function serverView(server: RegisteredMcpServer, agents: McpAgentUse[]): McpServerView {
  return {
    slug: server.slug,
    label: server.label,
    url: server.url,
    headerName: server.headerName ?? MCP_DEFAULT_HEADER,
    secret: { configured: server.secret !== undefined },
    timeoutSeconds: server.timeoutSeconds ?? WEBHOOK_DEFAULT_TIMEOUT_SECONDS,
    fetchedAt: server.fetchedAt,
    tools: server.tools,
    agents,
  };
}

export async function listServers(q: OrgQuery, deps: ServerDeps): Promise<McpServerView[]> {
  const servers = await loadMcpServers(q, deps.secretKey);
  return Promise.all(servers.map(async (server) => serverView(server, await agentsUsing(q, server.slug))));
}

/** Grava a lista inteira e a relê pela mesma conferência da ligação: forma errada desfaz a transação. */
async function writeServers(q: OrgQuery, deps: ServerDeps, servers: RegisteredMcpServer[]): Promise<void> {
  if (servers.length === 0) {
    await q.exec("delete from settings where key = $1", [MCP_SERVERS_KEY]);
    return;
  }
  const stored = servers.map(({ secret, ...server }) => ({
    ...server,
    ...(secret !== undefined && {
      secret: encryptSecret(secret, deps.secretKey),
    }),
  }));
  await q.exec(
    `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, true, $4)
     on conflict (organization_id, key) do update set value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at`,
    [q.organizationId, MCP_SERVERS_KEY, JSON.stringify(stored), deps.clock.now()],
  );
  await loadMcpServers(q, deps.secretKey);
}

/** Tira de todo agente da organização os nomes dados. Devolve os agentes que mudaram, pelo nome. */
async function dropAgentTools(q: OrgQuery, deps: ServerDeps, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const rows = await q.many<{ name: string }>("update agents set tools = array(select t from unnest(tools) t where t <> all($1::text[])), updated_at = $2 where tools && $1::text[] returning name", [
    names,
    deps.clock.now(),
  ]);
  return rows.map((row) => row.name).sort();
}

/** O segredo que vale para o endereço: o novo, ou o gravado só se o endereço for o mesmo. */
const secretFor = (previous: RegisteredMcpServer | undefined, input: { url: string; secret?: string }): string | undefined =>
  input.secret ?? (previous?.url === input.url ? previous.secret : undefined);

const loadOne = async (q: OrgQuery, deps: ServerDeps, slug: string) => {
  const servers = await loadMcpServers(q, deps.secretKey);
  return { servers, server: servers.find((item) => item.slug === slug) };
};

/**
 * Serializa as gravações dos servidores MCP de uma organização até o fim da transação. Um `FOR UPDATE`
 * na leitura não bastaria: antes do primeiro servidor a linha de `settings` não existe, e duas
 * criações leriam a lista vazia e a segunda sobrescreveria a primeira. A trava vale também sem linha.
 */
const lockServers = (q: OrgQuery): Promise<number> =>
  q.exec("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`deskvoice:${MCP_SERVERS_KEY}:${q.organizationId}`]);

/** A lista e o servidor, lidos depois da trava: quem grava a partir dela não perde a gravação de outro pedido. */
const loadLocked = async (q: OrgQuery, deps: ServerDeps, slug: string) => {
  await lockServers(q);
  return loadOne(q, deps, slug);
};

/** Lê o servidor gravado fora da transação da rota: é para montar a busca que vem antes dela. */
export const storedServer = (deps: ServerDeps, session: Session, slug: string): Promise<RegisteredMcpServer | undefined> =>
  withOrg(deps.db, session.organizationId, async (q) => (await loadOne(q, deps, slug)).server);

/** O pedido de criação não cai em cima de um servidor gravado: o `slug` é único na organização. */
export const refuseTaken = (create: boolean | undefined, previous: RegisteredMcpServer | undefined): void => {
  if (create === true && previous !== undefined)
    throw new ApiError(409, "mcp_server_exists", "A server with this slug already exists. Choose another slug, or edit the existing server.");
};

/** O que a busca antes da transação usou e trouxe. */
export interface Looked {
  secret: string | undefined;
  list: McpToolList;
}

/**
 * Grava o servidor com o retrato da busca e as marcas da tela. Cada ferramenta da tela tem de
 * existir na busca com a mesma impressão digital; o que não bate é recusado, e nada muda.
 */
export async function saveServer(q: OrgQuery, deps: ServerDeps, slug: string, body: z.output<typeof saveBody>, looked: Looked): Promise<McpServerView & { droppedFrom: string[] }> {
  const { servers, server: previous } = await loadLocked(q, deps, slug);
  // De novo dentro da transação, depois da trava: outro pedido pode ter criado o mesmo `slug` depois
  // da busca, e o simultâneo espera este terminar e recebe o 409.
  refuseTaken(body.create, previous);
  const keptSecret = secretFor(previous, body);
  // O gravado mudou entre a busca e a transação: a busca foi feita com outra credencial.
  if (keptSecret !== looked.secret) throw new ApiError(409, "mcp_server_changed", "The server changed while it was being saved. Load the page again.");

  const live = new Map(looked.list.tools.map((tool) => [tool.name, tool]));
  const stale = body.tools.filter((tool) => live.get(tool.name)?.fingerprint !== tool.fingerprint).map((tool) => tool.name);
  if (stale.length > 0)
    throw new ApiError(409, "mcp_snapshot_changed", `These tools changed on the server or no longer exist: ${stale.join(", ").slice(0, 300)}. Look the tools up again.`, {
      tools: stale.join(", ").slice(0, 300),
    });
  const unsupported = body.tools.filter((tool) => tool.allowed && live.get(tool.name)?.supported !== true).map((tool) => tool.name);
  if (unsupported.length > 0)
    throw new ApiError(400, "mcp_tool_unsupported", `These tools cannot be enabled: ${unsupported.join(", ").slice(0, 300)}.`, { tools: unsupported.join(", ").slice(0, 300) });

  const marks = new Map(body.tools.map((tool) => [tool.name, tool]));
  const before = new Map((previous?.tools ?? []).map((tool) => [tool.name, tool]));
  const tools: McpToolSnapshot[] = looked.list.tools.map((tool: DiscoveredTool) => {
    const mark = marks.get(tool.name);
    const old = before.get(tool.name);
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      fingerprint: tool.fingerprint,
      allowed: tool.supported && mark?.allowed === true,
      writes: mark?.writes ?? true,
      needsApproval: mark?.needsApproval ?? (old?.fingerprint === tool.fingerprint ? old.needsApproval : false),
      supported: tool.supported,
    };
  });

  // Ferramenta que algum agente usa e deixa de valer pede o `slug` digitado, como o descadastro.
  const enabled = new Set(tools.filter((tool) => tool.allowed).map((tool) => mcpToolName(slug, tool.name)));
  const users = await agentsUsing(q, slug);
  const leaving = [...new Set(users.flatMap((agent) => agent.tools))].filter((name) => !enabled.has(name)).sort();
  if (leaving.length > 0 && body.confirm !== slug) {
    const names = users.filter((agent) => agent.tools.some((name) => leaving.includes(name))).map((agent) => agent.name);
    throw new ApiError(409, "mcp_tools_in_use", `Agents use tools that would be disabled (${leaving.join(", ")}): ${names.join(", ")}. Type the server slug to confirm.`, {
      agents: names.join(", ").slice(0, 500),
      tools: leaving.join(", ").slice(0, 500),
    });
  }

  const saved: RegisteredMcpServer = {
    slug,
    label: body.label,
    url: body.url,
    ...(body.headerName !== undefined &&
      body.headerName !== MCP_DEFAULT_HEADER && {
        headerName: body.headerName,
      }),
    ...(keptSecret !== undefined && { secret: keptSecret }),
    ...(body.timeoutSeconds !== undefined && {
      timeoutSeconds: body.timeoutSeconds,
    }),
    fetchedAt: deps.clock.now().toISOString(),
    tools,
  };
  await writeServers(q, deps, previous ? servers.map((item) => (item.slug === slug ? saved : item)) : [...servers, saved]);
  const droppedFrom = await dropAgentTools(q, deps, leaving);
  return { ...serverView(saved, await agentsUsing(q, slug)), droppedFrom };
}

export type ToolChange = "new" | "changed" | "gone" | "same";

/**
 * Compara a busca nova com o retrato gravado, sem gravar. A ferramenta que mudou e a nova voltam
 * desmarcadas; a igual guarda as marcas. Quem grava é o `PUT`, com a confirmação dele.
 */
export function refreshView(server: RegisteredMcpServer, list: McpToolList) {
  const before = new Map(server.tools.map((tool) => [tool.name, tool]));
  const changes: Array<{ name: string; change: ToolChange }> = [];
  const tools = list.tools.map((tool) => {
    const old = before.get(tool.name);
    const change: ToolChange = old === undefined ? "new" : old.fingerprint === tool.fingerprint ? "same" : "changed";
    changes.push({ name: tool.name, change });
    const keep = change === "same" && old !== undefined;
    return {
      ...tool,
      allowed: keep && old.allowed && tool.supported,
      writes: keep ? old.writes : true,
      needsApproval: keep ? old.needsApproval : false,
    };
  });
  const live = new Set(list.tools.map((tool) => tool.name));
  for (const tool of server.tools) if (!live.has(tool.name)) changes.push({ name: tool.name, change: "gone" });
  return {
    slug: server.slug,
    changes,
    tools,
    omitted: list.omitted,
    incomplete: list.incomplete,
  };
}

/** Descadastra: some o servidor, e os nomes `<slug>__*` saem de todo agente da organização, na mesma transação. */
export async function removeServer(q: OrgQuery, deps: ServerDeps, slug: string): Promise<{ slug: string; droppedFrom: string[] }> {
  const { servers, server } = await loadLocked(q, deps, slug);
  if (!server) throw new ApiError(404, "not_found", "Not found.");
  const names = [...new Set((await agentsUsing(q, slug)).flatMap((agent) => agent.tools))];
  await writeServers(
    q,
    deps,
    servers.filter((item) => item.slug !== slug),
  );
  return { slug, droppedFrom: await dropAgentTools(q, deps, names) };
}
