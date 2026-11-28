// A sessão de suporte da instalação (`users.kind = 'support'`, R8 seção 3.6) entra como `admin`, mas
// não convida, não mexe na equipe nem na conta e não cria nada que dure mais que ela. As rotas vêm
// da tabela `fences/support-session-routes.ts`, nunca de uma lista copiada aqui: cada linha `forbid`
// é chamada com a sessão de suporte, que recebe 403 sem o banco mudar, e com um `admin` da equipe
// igual, que não recebe essa recusa. Sem o par, o teste passaria com tudo recusado.
//
// O vínculo e a sessão de suporte nascem como em produção: a conta que administra a instalação
// entra pela própria sessão, de outra organização, com `startSupportAccess`.
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { encryptSecret, recordingPath, startSupportAccess, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { SUPPORT_SESSION_ROUTES, type SupportSessionRoute } from "../../../../../../fences/support-session-routes";
import { SUPPORT_SESSION_FORBIDDEN, type RouteContext } from "../../../server/context";
import { QR_PNG, startFakeWaha } from "../../../../../../packages/tools/test/fake-waha";
import { fakeMcp, tool as mcpTool } from "../../../../../../packages/tools/test/mcp-server";
import { MCP_SERVERS_KEY, mcpToolFingerprint } from "@deskvoice/tools";
import { AGENT_TOKEN, NOW, PASSWORD, call, createCall, createOrganization, createUser, insert, startPanel, type Result } from "../../../../test/kit";
import type { WhatsAppView } from "../../../server/whatsapp";
import type { WhatsAppCallsView } from "../../../server/whatsapp-calls";
import { POST as agentSays } from "./system/agent/route";
import { POST as invite } from "./team/invites/route";
import { POST as connectCalls } from "./whatsapp-calls/connect/route";
import { PATCH as chooseCallsAgent, GET as readCalls } from "./whatsapp-calls/route";
import { POST as callsService } from "./whatsapp-calls/service/route";
import { POST as connectWhatsApp } from "./whatsapp/connect/route";
import { GET as readWhatsApp } from "./whatsapp/route";
import { POST as whatsappService } from "./whatsapp/service/route";
import en from "../../../i18n/en/common";
import es from "../../../i18n/es/common";
import ptBR from "../../../i18n/pt-BR/common";

const panel = startPanel();
const waha = await startFakeWaha();
afterAll(async () => {
  await waha.stop();
  await panel.close();
});

type Handler = (request: Request, context: RouteContext) => Promise<Response>;

// O servidor MCP falso das linhas `mcp-servers/**`: o `admin` da equipe descobre, grava, busca de novo
// e descadastra de verdade. Qualquer outro destino segue recusando a conexão, como antes.
const MCP_URL = "https://mcp.example.test/mcp";
const MCP_TOOL = mcpTool("consultar_pedido");
const MCP_FINGERPRINT = mcpToolFingerprint({ name: MCP_TOOL.name, description: MCP_TOOL.description, inputSchema: MCP_TOOL.inputSchema });
panel.voice.respond = (url, init) => {
  if (url === MCP_URL) return fakeMcp({ pages: [[MCP_TOOL]] }).fetch(url, init);
  throw new Error("connect ECONNREFUSED");
};

async function handlerOf(row: SupportSessionRoute): Promise<Handler> {
  // O caminho vem da tabela: o import com variável precisa do caminho inteiro.
  const module = (await import(/* @vite-ignore */ path.join(import.meta.dirname, row.route, "route.ts"))) as Partial<Record<string, Handler>>;
  const handler = module[row.method];
  if (!handler) throw new Error(`${row.method} ${row.route}: the route does not export this method`);
  return handler;
}

/** Marca a conta como quem administra a instalação: o vínculo de suporte, na 5c, é de uma conta assim. */
async function administers(accountId: string): Promise<void> {
  await withSystem(panel.app, (q) => q.exec("update accounts set installation_admin_at = $2 where id = $1", [accountId, NOW]));
}

/**
 * Uma organização com um `admin` da equipe e um vínculo de suporte `admin` com sessão, os dois
 * criados aqui, e mais o que as rotas precisam encontrar (pessoas da equipe, convite, ligação).
 */
async function scene(label: string) {
  const org = await createOrganization(panel.app, `Suporte ${label}`);
  await createUser(panel.app, org, "owner");
  const member = await createUser(panel.app, org, "admin");
  const memberAccount = (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [member.id])))?.id ?? "";
  await administers(memberAccount);

  // Quem dá suporte é `member` de outra organização (a de casa) e entra nesta pela própria sessão.
  const home = await createOrganization(panel.app, `Casa ${label}`);
  const supporter = await createUser(panel.app, home, "owner");
  const supportAccount = (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [supporter.id])))?.id ?? "";
  await administers(supportAccount);
  const sessionId = (await withSystem(panel.app, (q) => q.one<{ id: string }>("select id from sessions where user_id = $1", [supporter.id])))?.id ?? "";
  const started = await startSupportAccess(panel.app, { actorAccountId: supportAccount, sessionId, organizationId: org, reason: "Ajuda com a configuração", minutes: 60 }, NOW);
  if (!started.ok) throw new Error(`the support access did not start: ${started.reason}`);
  const support = started.userId;

  const operator = await createUser(panel.app, org, "operator");
  const callId = await createCall(panel.app, org, NOW);
  // O link público só se cria para ligação com gravação no disco.
  const audio = recordingPath(panel.deps.recordingsDir, org, callId);
  await mkdir(path.dirname(audio), { recursive: true });
  await writeFile(audio, Buffer.from("RIFF"));
  const created = await call(invite, { method: "POST", cookie: member.cookie, body: { email: `invited-${randomUUID()}@example.test`, name: "Convidada", role: "operator" } });
  const data = created.data as { id: string; link: string };
  const other = await createOrganization(panel.app, `Outra ${label}`);
  const trunk = await insert(panel.app, org, "insert into trunks (organization_id, name, host, auth_mode) values ($1, 'Operadora', '203.0.113.62', 'ip') returning id", [org]);
  const agent = await insert(panel.app, org, "insert into agents (organization_id, name, engine) values ($1, 'Recepção', 'simulated') returning id", [org]);
  // Um servidor MCP gravado, para o `admin` gravar por cima, buscar de novo e descadastrar.
  const mcpServer = {
    slug: "erp",
    label: "ERP",
    url: MCP_URL,
    secret: encryptSecret("Bearer s3cret", panel.deps.secretKey),
    fetchedAt: NOW.toISOString(),
    tools: [{ ...MCP_TOOL, fingerprint: MCP_FINGERPRINT, allowed: true, writes: true, needsApproval: false, supported: true }],
  };
  await withSystem(panel.app, (q) => q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, $3, true)", [org, MCP_SERVERS_KEY, JSON.stringify([mcpServer])]));
  return {
    org,
    other,
    member,
    support: { id: support, cookie: supporter.cookie },
    operator,
    callId,
    trunk,
    agent,
    invite: { id: data.id, token: data.link.split("/invite/")[1] ?? "" },
  };
}
type Scene = Awaited<ReturnType<typeof scene>>;

interface Prepared {
  params: Record<string, string>;
  body?: unknown;
  /** O `admin` da equipe consegue: o pedido é de verdade, e só a sessão de suporte é recusada. */
  works?: true;
}

/**
 * O pedido de cada linha que precisa de um registro de verdade para valer. Não é a lista de rotas:
 * a linha que não está aqui é chamada com `id` sorteado e corpo vazio, e precisa ser recusada igual.
 */
const REQUESTS: Record<string, (s: Scene) => Prepared> = {
  "POST team/invites": () => ({ params: {}, body: { email: `invited-${randomUUID()}@example.test`, name: "Nova", role: "admin" }, works: true }),
  "DELETE team/invites/[id]": (s) => ({ params: { id: s.invite.id }, works: true }),
  "PATCH team/users/[id]": (s) => ({ params: { id: s.operator.id }, body: { role: "admin" }, works: true }),
  "DELETE team/users/[id]": (s) => ({ params: { id: s.operator.id }, works: true }),
  "POST invites/[token]/accept": (s) => ({ params: { token: s.invite.token }, body: { name: "Convidada", password: "a-long-enough-password" }, works: true }),
  "POST installation/organizations/[id]/invite": (s) => ({ params: { id: s.other }, body: { email: `owner-${randomUUID()}@example.test`, name: "Dona" }, works: true }),
  "POST installation/admins": () => ({ params: {}, body: { email: `admin-${randomUUID()}@example.test` } }),
  "POST auth/password": () => ({ params: {}, body: { current: PASSWORD, new: "another-long-enough-password" }, works: true }),
  "PATCH auth/me": () => ({ params: {}, body: { phone: "+5531999990002", whatsapp: "+5531999990002" }, works: true }),
  "POST auth/switch": (s) => ({ params: {}, body: { organizationId: s.other } }),
  "POST calls/[id]/share": (s) => ({ params: { id: s.callId }, body: {}, works: true }),
  "PUT brains/[brain]/key": () => ({ params: { brain: "openrouter" }, body: { apiKey: "sk-or-key-for-the-test" }, works: true }),
  "PUT synthesizers/[synthesizer]/key": () => ({ params: { synthesizer: "elevenlabs" }, body: { apiKey: "el-key-for-the-test", confirmedProvider: "elevenlabs" }, works: true }),
  "PUT speech-filter/[model]/key": () => ({ params: { model: "jev" }, body: { apiKey: "ts-key-for-the-test" }, works: true }),
  // `confirmOverlap`: cada cena cria a mesma linha em outra organização (o aviso tem teste próprio).
  "POST trunks": () => ({ params: {}, body: { name: "Nova operadora", host: "203.0.113.61", authMode: "ip", confirmOverlap: true }, works: true }),
  "PATCH trunks/[id]": (s) => ({ params: { id: s.trunk }, body: { name: "Operadora renomeada" }, works: true }),
  "POST agents": () => ({ params: {}, body: { name: "Vendas", engine: "simulated" }, works: true }),
  "PATCH agents/[id]": (s) => ({ params: { id: s.agent }, body: { name: "Recepção renomeada" }, works: true }),
  "PUT outbound-policy": () => ({ params: {}, body: { enabled: true, purpose: "Retorno a quem pediu", legalBasis: "Consentimento", dailyCapPerLine: 2000 }, works: true }),
  "POST mcp-servers/discover": () => ({ params: {}, body: { url: MCP_URL, secret: "Bearer digitado" }, works: true }),
  "PUT mcp-servers/[slug]": () => ({ params: { slug: "erp" }, body: { label: "ERP", url: MCP_URL, tools: [{ name: MCP_TOOL.name, fingerprint: MCP_FINGERPRINT, allowed: true }] }, works: true }),
  "POST mcp-servers/[slug]/refresh": () => ({ params: { slug: "erp" }, works: true }),
  "DELETE mcp-servers/[slug]": () => ({ params: { slug: "erp" }, body: { confirm: "erp" }, works: true }),
  "PUT settings/[key]": () => ({ params: { key: "whatsapp.connector" }, body: { value: { type: "webhook", url: "https://hooks.example.test/in", token: "hook-token" } }, works: true }),
};

function fallback(row: SupportSessionRoute): Prepared {
  const params: Record<string, string> = {};
  for (const [, name] of row.route.matchAll(/\[(\w+)\]/g)) params[name ?? ""] = name === "id" ? randomUUID() : "x";
  return { params, body: {} };
}

/**
 * Uma impressão de todo o banco: cada tabela que o papel de sistema lê, linha a linha. Os testes com
 * banco rodam um arquivo de cada vez, então o que mudar entre duas leituras foi a requisição.
 */
async function fingerprint(): Promise<Record<string, string>> {
  return withSystem(panel.app, async (q) => {
    const tables = await q.many<{ name: string }>(
      "select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public' and has_table_privilege(format('%I.%I', schemaname, tablename), 'select') order by 1",
    );
    const out: Record<string, string> = {};
    for (const { name } of tables) {
      const rows = await q.many<{ line: string }>(`select t::text as line from ${name} t`);
      out[name] = createHash("sha256").update(rows.map((row) => row.line).sort().join("\n")).digest("hex");
    }
    return out;
  });
}

const sent = (handler: Handler, method: string, cookie: string, request: Prepared): Promise<Result> =>
  call(handler, { method, cookie, params: request.params, ...(request.body !== undefined && { body: request.body }) });

const forbidden = SUPPORT_SESSION_ROUTES.filter((row) => row.rule === "forbid");

describe("a support session", () => {
  it("has rows to refuse, and every prepared request names a row of the table", () => {
    expect(forbidden.length).toBeGreaterThan(0);
    for (const id of Object.keys(REQUESTS)) expect(forbidden.map((row) => `${row.method} ${row.route}`)).toContain(id);
  });

  it("has its refusal written in the three dictionaries", () => {
    for (const dictionary of [ptBR, en, es]) expect(dictionary.errors[SUPPORT_SESSION_FORBIDDEN]).toMatch(/\S/);
  });

  it.each(forbidden.map((row) => [`${row.method} ${row.route}`, row] as const))("is refused at %s, before anything is written; a team admin is not", async (id, row) => {
    const s = await scene(id);
    const handler = await handlerOf(row);
    const request = (REQUESTS[id] ?? (() => fallback(row)))(s);

    const before = await fingerprint();
    const refused = await sent(handler, row.method, s.support.cookie, request);
    expect([refused.status, refused.code]).toEqual([403, SUPPORT_SESSION_FORBIDDEN]);
    expect(await fingerprint()).toEqual(before);
    // Nada saiu para o processo de voz, o WAHA ou o agente: a recusa vem antes do `before` e do `after`.
    expect(panel.voice.requests).toEqual([]);

    const answered = await sent(handler, row.method, s.member.cookie, request);
    expect(answered.code).not.toBe(SUPPORT_SESSION_FORBIDDEN);
    if (request.works) expect([answered.status, answered.code]).toEqual([200, undefined]);
    panel.voice.requests.length = 0;
  });

  // Duas linhas `allow`, lidas da tabela: a sessão de suporte faz o trabalho de um `admin` ali.
  const allowed = (route: string, method: string): SupportSessionRoute => {
    const row = SUPPORT_SESSION_ROUTES.find((r) => r.route === route && r.method === method);
    expect(row?.rule).toBe("allow");
    return row as SupportSessionRoute;
  };

  it("adds a number to the do-not-call list, like any admin", async () => {
    const s = await scene("do-not-call");
    const result = await sent(await handlerOf(allowed("do-not-call", "POST")), "POST", s.support.cookie, { params: {}, body: { numbers: ["+5531988887777"] } });
    expect([result.status, result.code]).toEqual([200, undefined]);
    const stored = await withOrg(panel.app, s.org, (q) => q.one<{ n: number }>("select count(*)::int as n from do_not_call where e164 = '+5531988887777'"));
    expect(stored?.n).toBe(1);
  });

  it("changes the transcript retention, like any admin", async () => {
    const s = await scene("retention");
    const result = await sent(await handlerOf(allowed("privacy/retention", "PUT")), "PUT", s.support.cookie, { params: {}, body: { days: null } });
    expect([result.status, result.code]).toEqual([200, undefined]);
  });

  it("is still a session: who am I answers, and only routes that say `support: false` refuse it", async () => {
    const s = await scene("me");
    const { GET: me } = await import("./auth/me/route");
    const result = await call(me, { cookie: s.support.cookie });
    expect(result.status).toBe(200);
  });
  // A leitura também tem régua: a sessão de suporte vê o estado dos canais, mas nunca recebe o
  // material de pareamento. As duas conexões ficam em "qr" de verdade, pedidas pelo `admin` da equipe.
  it("sees both WhatsApp channels waiting for the QR Code, but never gets the code; a team admin does", async () => {
    const s = await scene("pairing");
    const respond = panel.voice.respond;
    panel.deps.waha = waha.options;
    panel.voice.respond = () => Response.json({ session: { id: "wacalls-pairing", status: "qr", qr: "2@pairing-material-for-the-test", phone: null } });
    try {
      const running = { state: "running" };
      for (const service of [whatsappService, callsService]) expect((await call(service, { method: "POST", cookie: s.member.cookie, body: { wanted: true } })).status).toBe(200);
      await call(agentSays, { method: "POST", body: { version: "0.5.0", whatsapp: running, whatsappCalls: running }, headers: { authorization: `Bearer ${AGENT_TOKEN}` } });
      expect((await call(connectWhatsApp, { method: "POST", cookie: s.member.cookie, body: {} })).data).toMatchObject({ status: "qr" });
      expect((await call(connectCalls, { method: "POST", cookie: s.member.cookie, body: {} })).data).toMatchObject({ status: "qr" });

      const readings = {
        "GET whatsapp": (cookie: string) => call(readWhatsApp, { cookie }),
        "GET whatsapp-calls": (cookie: string) => call(readCalls, { cookie }),
        "PATCH whatsapp-calls": (cookie: string) => call(chooseCallsAgent, { method: "PATCH", cookie, body: { agentId: s.agent } }),
      };
      for (const [id, read] of Object.entries(readings)) {
        const support = await read(s.support.cookie);
        expect([id, support.status, support.code]).toEqual([id, 200, undefined]);
        expect([id, (support.data as WhatsAppView | WhatsAppCallsView).status, (support.data as WhatsAppView | WhatsAppCallsView).qr]).toEqual([id, "qr", null]);
        const member = await read(s.member.cookie);
        expect([id, (member.data as WhatsAppView | WhatsAppCallsView).status]).toEqual([id, "qr"]);
        expect([id, (member.data as WhatsAppView | WhatsAppCallsView).qr]).toEqual([id, id.endsWith("whatsapp") ? `data:image/png;base64,${QR_PNG}` : expect.stringMatching(/^data:image\/svg\+xml;base64,/)]);
      }
      // `connect` e `service` devolvem o estado com o QR Code a quem pode parear. Com as duas
      // conexões em "qr" de verdade, a sessão de suporte é recusada antes de qualquer resposta.
      const pairing = { "POST whatsapp/connect": connectWhatsApp, "POST whatsapp-calls/connect": connectCalls, "POST whatsapp/service": whatsappService, "POST whatsapp-calls/service": callsService };
      for (const [id, route] of Object.entries(pairing)) {
        const refused = await call(route, { method: "POST", cookie: s.support.cookie, body: id.endsWith("service") ? { wanted: true } : {} });
        expect([id, refused.status, refused.code, refused.text.includes("data:image")]).toEqual([id, 403, SUPPORT_SESSION_FORBIDDEN, false]);
      }
    } finally {
      panel.deps.waha = { apiKey: "" };
      panel.voice.respond = respond;
      panel.voice.requests.length = 0;
      // O banco é um só para os testes de banco: o pedido dos serviços não vaza para os outros arquivos.
      await withSystem(panel.app, async (q) => {
        await q.exec("update whatsapp_sessions set service_wanted = false");
        await q.exec("update whatsapp_call_sessions set service_wanted = false");
      });
    }
  });
});
