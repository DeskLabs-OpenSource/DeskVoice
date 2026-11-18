// O aceite da fatia 5 (R8, seção 4, item 3): na sessão de suporte, nada da organização de origem nem
// de uma terceira aparece em nenhuma rota. Três organizações com dados: a conta que administra a
// instalação é `member` em A e entra em B como suporte; C é uma terceira.
//
// As rotas `GET` vêm do disco (todo `route.ts` do painel que exporta `GET`), nunca de uma lista
// copiada aqui. Cada resposta, inteira, é procurada pelos `id` de A e de C (toda linha das tabelas com
// `organization_id` e `id` uuid, lidas do catálogo) e pelo nome das duas, e por segredo: QR Code, chave de
// provedor em claro e token.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { hashToken, recordInstallationEvent, recordingPath, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QR_PNG, startFakeWaha } from "../../../../../../packages/tools/test/fake-waha";
import { AGENT_TOKEN, NOW, call, createCall, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import type { RouteContext } from "../../../server/context";
import { PUT as putBrainKey } from "./brains/[brain]/key/route";
import { POST as support } from "./installation/organizations/[id]/support/route";
import { PUT as putSetting } from "./settings/[key]/route";
import { POST as agentSays } from "./system/agent/route";
import { POST as connectCalls } from "./whatsapp-calls/connect/route";
import { POST as callsService } from "./whatsapp-calls/service/route";
import { POST as connectWhatsApp } from "./whatsapp/connect/route";
import { POST as whatsappService } from "./whatsapp/service/route";

const panel = startPanel();
const waha = await startFakeWaha();
afterAll(async () => {
  panel.deps.waha = { apiKey: "" };
  await withSystem(panel.app, async (q) => {
    await q.exec("update whatsapp_sessions set service_wanted = false");
    await q.exec("update whatsapp_call_sessions set service_wanted = false");
  });
  await waha.stop();
  await panel.close();
});

type Handler = (request: Request, context: RouteContext) => Promise<Response>;

const APP_DIR = path.resolve(import.meta.dirname, "../..");
const GET_EXPORT = /^export\s+(?:const|async\s+function|function)\s+GET\b|^export\s*\{[^}]*\bGET\b[^}]*\}/m;

/** Toda rota do painel que exporta `GET`, lida do disco: o caminho sob `src/app`, sem `/route.ts`. */
async function getRoutes(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === "route.ts" && GET_EXPORT.test(await readFile(full, "utf8"))) out.push(path.relative(APP_DIR, dir).split(path.sep).join("/"));
    }
  };
  await walk(APP_DIR);
  return out.sort();
}

/**
 * Rotas `GET` que este teste não chama, com o motivo. Rota nova não entra aqui sozinha: ela é
 * chamada, e só sai se alguém escrever o motivo na revisão.
 */
const NOT_CALLED: Record<string, string> = {};

/**
 * Tabelas cujas linhas são da instalação, mesmo tendo `organization_id`, com o motivo: o `id` delas
 * pode aparecer para qualquer sessão. Entrada nova é decisão de revisão.
 */
const INSTALLATION_ROWS: Record<string, string> = {
  update_requests: "o pedido de atualização é da instalação (seção 3.11): toda sessão vê o mais recente, de qualquer organização",
};

const LEAK_KEY = `sk-or-leak-${randomUUID()}`;
const HOOK_TOKEN = `hook-${randomUUID()}`;
const PAIRING = "2@pairing-material-for-the-leak-test";

interface Seeded {
  org: string;
  name: string;
  owner: Awaited<ReturnType<typeof createUser>>;
  callId: string;
  agent: string;
  analyst: string;
  inviteToken: string;
  shareToken: string;
}

/** Uma organização com uma linha em cada canto que uma rota `GET` mostra. */
async function seed(label: string): Promise<Seeded> {
  const name = `${label} ${randomUUID()}`;
  const org = await createOrganization(panel.app, name);
  await withSystem(panel.app, (q) => q.exec("update organizations set name = $2 where id = $1", [org, name]));
  const owner = await createUser(panel.app, org, "owner");
  const operator = await createUser(panel.app, org, "operator");
  const trunk = await insert(panel.app, org, "insert into trunks (organization_id, name, host, auth_mode) values ($1, 'Operadora', 'sip.example.test', 'register') returning id", [org]);
  const analyst = await insert(panel.app, org, "insert into analysts (organization_id, name, decision_model, created_at, updated_at) values ($1, $2, 'jev', $3, $3) returning id", [org, `Analista ${label}`, NOW]);
  const agent = await insert(panel.app, org, "insert into agents (organization_id, name, engine, analyst_id) values ($1, 'Recepção', 'simulated', $2) returning id", [org, analyst]);
  await insert(panel.app, org, "insert into phone_numbers (organization_id, trunk_id, e164, agent_id) values ($1, $2, $3, $4) returning id", [
    org,
    trunk,
    `+5531${Math.floor(1e8 + Math.random() * 9e8)}`,
    agent,
  ]);
  const callId = await createCall(panel.app, org, NOW);
  const inviteToken = randomBytes(32).toString("base64url");
  const shareToken = randomBytes(32).toString("base64url");
  await withOrg(panel.app, org, async (q) => {
    await q.exec("update calls set agent_id = $2, from_e164 = '+5531999990000', summary = 'Pediu retorno' where id = $1", [callId, agent]);
    await q.exec("insert into call_events (organization_id, call_id, at, kind, payload) values ($1, $2, $3, 'call_started', '{}')", [org, callId, NOW]);
    await q.exec("insert into approvals (organization_id, call_id, question, default_on_timeout, expires_at) values ($1, $2, 'Pode dar desconto?', 'denied', $3)", [org, callId, new Date(NOW.getTime() + 600_000)]);
    const followUp = await q.one<{ id: string }>(
      "insert into follow_ups (organization_id, call_id, title, owner_user_id, due_at, created_at) values ($1, $2, 'Retornar', $3, $4, $4) returning id",
      [org, callId, operator.id, NOW],
    );
    await q.exec("insert into notifications (organization_id, call_id, follow_up_id, channel, body) values ($1, $2, $3, 'panel', 'Retornar a ligação')", [org, callId, followUp?.id]);
    await q.exec("insert into caller_notes (organization_id, call_id, caller_e164, text, created_at) values ($1, $2, '+5531999990000', 'Prefere de manhã', $3)", [org, callId, NOW]);
    await q.exec("insert into do_not_call (organization_id, e164) values ($1, $2)", [org, `+5531${Math.floor(1e8 + Math.random() * 9e8)}`]);
    await q.exec("insert into usage_ledger (organization_id, call_id, engine, at, seconds, cost_microcents) values ($1, $2, 'simulated', $3, 60, 1000)", [org, callId, NOW]);
    await q.exec("insert into invites (organization_id, email, name, role, token_hash, expires_at, created_by) values ($1, $2, 'Convidada', 'operator', $3, $4, $5)", [
      org,
      `invited-${randomUUID()}@example.test`,
      hashToken(inviteToken),
      new Date(NOW.getTime() + 86_400_000),
      owner.id,
    ]);
    await q.exec(
      "insert into share_links (organization_id, call_id, token_hash, kind, expires_at, max_uses, created_by, created_at) values ($1, $2, $3, 'recording', $4, 10, $5, $6)",
      [org, callId, hashToken(shareToken), new Date(NOW.getTime() + 86_400_000), owner.id, NOW],
    );
    await q.exec("insert into organization_events (organization_id, at, kind, actor_user_id, payload) values ($1, $2, 'caller_memory_changed', $3, '{\"to\": true}')", [org, NOW, owner.id]);
  });
  const audio = recordingPath(panel.deps.recordingsDir, org, callId);
  await mkdir(path.dirname(audio), { recursive: true });
  await writeFile(audio, Buffer.from("RIFF"));
  await withSystem(panel.app, (q) => recordInstallationEvent(q, NOW, "organization_renamed", { organizationId: org, payload: { from: label, to: name } }));
  return { org, name, owner, callId, agent, analyst, inviteToken, shareToken };
}

/** Os valores de cada parâmetro de rota, sempre de B. Não é a lista de rotas: é o que preencher. */
function paramsFor(route: string, b: Seeded): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [, name] of route.matchAll(/\[(\w+)\]/g)) {
    if (name === "id") {
      const [first] = route.replace(/^api\/v1\//, "").split("/");
      params.id = { calls: b.callId, agents: b.agent, analysts: b.analyst, installation: b.org }[first ?? ""] ?? randomUUID();
    } else if (name === "token") params.token = route.startsWith("s/") ? b.shareToken : b.inviteToken;
    else if (name === "brain") params.brain = "openrouter";
    else if (name === "synthesizer") params.synthesizer = "elevenlabs";
    else if (name === "key") params.key = "webhooks.allowed";
    else params[name ?? ""] = "x";
  }
  return params;
}

/** Chama a rota e devolve a resposta inteira como texto. Do fluxo de eventos, o que chegar primeiro. */
async function read(handler: Handler, route: string, params: Record<string, string>, cookie: string): Promise<{ status: number; text: string }> {
  const abort = new AbortController();
  const request = new Request(`https://panel.test/${route}`, { headers: { cookie }, signal: abort.signal });
  const response = await handler(request, { params: Promise.resolve(params) });
  if (response.headers.get("content-type")?.includes("event-stream") && response.body) {
    const reader = response.body.getReader();
    const first = await reader.read();
    abort.abort();
    await reader.cancel();
    return { status: response.status, text: new TextDecoder().decode(first.value) };
  }
  return { status: response.status, text: Buffer.from(await response.arrayBuffer()).toString("latin1") };
}

/** Os `id` de toda linha de A e de C, de toda tabela do catálogo com `organization_id` e `id`. */
async function idsOf(organizations: string[]): Promise<Map<string, string>> {
  return withSystem(panel.app, async (q) => {
    const tables = await q.many<{ name: string }>(
      `select c.table_name as name from information_schema.columns c
        where c.table_schema = 'public' and c.column_name = 'organization_id'
          and exists (select from information_schema.columns i where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id' and i.data_type = 'uuid')
          and c.table_name not in ('installation_events')
        order by 1`,
    );
    const ids = new Map<string, string>();
    for (const { name } of tables) {
      if (Object.hasOwn(INSTALLATION_ROWS, name)) continue;
      for (const row of await q.many<{ id: string }>(`select id::text as id from "${name}" where organization_id = any($1::uuid[])`, [organizations])) ids.set(row.id, name);
    }
    for (const id of organizations) ids.set(id, "organizations");
    return ids;
  });
}

let routes: string[];
let a: Seeded;
let b: Seeded;
let c: Seeded;
let supporterCookie: string;
let forbidden: Map<string, string>;
let secrets: string[];

beforeAll(async () => {
  routes = await getRoutes();
  a = await seed("Origem A");
  b = await seed("Cliente B");
  c = await seed("Terceira C");
  // Um pedido de atualização de A, a linha que a instalação inteira vê (`INSTALLATION_ROWS`).
  await insert(panel.app, a.org, "insert into update_requests (organization_id, requested_by, status, from_version, target_version) values ($1, $2, 'succeeded', '0.1.0', '0.2.0') returning id", [
    a.org,
    a.owner.id,
  ]);

  // Os segredos de B, gravados por quem pode: uma chave de provedor e o token de um gancho.
  expect((await call(putBrainKey, { method: "PUT", cookie: b.owner.cookie, params: { brain: "openrouter" }, body: { apiKey: LEAK_KEY } })).status).toBe(200);
  expect(
    (await call(putSetting, { method: "PUT", cookie: b.owner.cookie, params: { key: "webhooks.allowed" }, body: { value: [{ name: "CRM", url: "https://hooks.example.test/in", token: HOOK_TOKEN }] } })).status,
  ).toBe(200);

  // Os dois canais de WhatsApp de B esperando o QR Code de verdade, pedidos pela dona de B.
  panel.deps.waha = waha.options;
  panel.voice.respond = () => Response.json({ session: { id: "wacalls-leak", status: "qr", qr: PAIRING, phone: null } });
  for (const service of [whatsappService, callsService]) expect((await call(service, { method: "POST", cookie: b.owner.cookie, body: { wanted: true } })).status).toBe(200);
  const running = { state: "running" };
  await call(agentSays, { method: "POST", body: { version: "0.5.0", whatsapp: running, whatsappCalls: running }, headers: { authorization: `Bearer ${AGENT_TOKEN}` } });
  const connected = await call(connectWhatsApp, { method: "POST", cookie: b.owner.cookie, body: {} });
  expect([connected.status, connected.code, connected.message, connected.data]).toMatchObject([200, undefined, undefined, { status: "qr" }]);
  expect((await call(connectCalls, { method: "POST", cookie: b.owner.cookie, body: {} })).data).toMatchObject({ status: "qr" });

  // A conta que administra a instalação: dona de A, com a marca, entra em B como suporte.
  const supporter = await createUser(panel.app, a.org, "owner");
  await withSystem(panel.app, (q) => q.exec("update accounts set installation_admin_at = $2 where id = (select account_id from users where id = $1)", [supporter.id, NOW]));
  const entered = await call(support, { method: "POST", cookie: supporter.cookie, params: { id: b.org }, body: { reason: "Conferir os canais do cliente", minutes: 60 } });
  expect(entered.status).toBe(200);
  supporterCookie = supporter.cookie;

  forbidden = await idsOf([a.org, c.org]);
  for (const seeded of [a, c]) forbidden.set(seeded.name, "organization name");
  const tokenOf = (cookie: string): string => cookie.split("=").slice(1).join("=");
  secrets = [LEAK_KEY, HOOK_TOKEN, PAIRING, QR_PNG, "data:image", tokenOf(supporterCookie), ...[a, b, c].flatMap((seeded) => [seeded.inviteToken, seeded.shareToken, tokenOf(seeded.owner.cookie)])];
});

/** O que a resposta traz que não podia: `id` ou nome de A e de C, ou segredo. */
function leaks(text: string): string[] {
  const found: string[] = [];
  for (const [value, table] of forbidden) if (text.includes(value)) found.push(`${table}:${value}`);
  for (const secret of secrets) if (text.includes(secret)) found.push(`secret:${secret.slice(0, 12)}`);
  return found;
}

const handlerOf = async (route: string): Promise<Handler> => {
  const module = (await import(/* @vite-ignore */ path.join(APP_DIR, route, "route.ts"))) as { GET?: Handler };
  if (!module.GET) throw new Error(`${route}: no GET`);
  return module.GET;
};

describe("a support session, on every GET route of the panel", () => {
  it("finds the GET routes on disk", () => {
    expect(routes.length).toBeGreaterThanOrEqual(41);
    expect(routes).toEqual(expect.arrayContaining(["api/v1/calls", "api/v1/installation/organizations", "api/v1/auth/organizations", "s/[token]/audio"]));
    for (const route of Object.keys(NOT_CALLED)) expect(routes).toContain(route);
  });

  it("never answers with an id or the name of the home organization or of a third one, nor a secret", async () => {
    const answered: Record<string, string[]> = {};
    for (const route of routes.filter((r) => !Object.hasOwn(NOT_CALLED, r))) {
      const result = await read(await handlerOf(route), route, paramsFor(route, b), supporterCookie);
      answered[route] = [String(result.status), ...leaks(result.text)];
    }
    const leaked = Object.entries(answered).filter(([, [, ...found]]) => found.length > 0);
    expect(Object.fromEntries(leaked)).toEqual({});
    // Ela é uma sessão de verdade em B: as rotas da organização respondem.
    for (const route of ["api/v1/calls", "api/v1/agents", "api/v1/team", "api/v1/whatsapp", "api/v1/whatsapp-calls"]) expect([route, answered[route]?.[0]]).toEqual([route, "200"]);
  });

  it("sees the client's own data, so the search above is not looking at empty answers", async () => {
    const calls = await read(await handlerOf("api/v1/calls"), "api/v1/calls", {}, supporterCookie);
    expect(calls.text).toContain(b.callId);
    const whatsapp = await read(await handlerOf("api/v1/whatsapp"), "api/v1/whatsapp", {}, supporterCookie);
    expect(whatsapp.text).toContain('"status":"qr"');
  });

  it("would catch a leak: a member of A, on the same routes, gets A's ids and the client's owner gets the QR Code", async () => {
    const member = await read(await handlerOf("api/v1/calls"), "api/v1/calls", {}, a.owner.cookie);
    expect(leaks(member.text)).toContain(`calls:${a.callId}`);
    const owner = await read(await handlerOf("api/v1/whatsapp"), "api/v1/whatsapp", {}, b.owner.cookie);
    expect(leaks(owner.text)).toContain(`secret:${"data:image".slice(0, 12)}`);
  });
});
