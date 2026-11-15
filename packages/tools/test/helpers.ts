import { randomBytes, randomUUID } from "node:crypto";
import { encryptSecret, withSystem, type ApprovalOutcome, type Db } from "@deskvoice/core";
import { createCall, createOrganization } from "../../core/test/helpers";
import { autoCommitOrgQuery } from "../src/org-query";
import type { ToolContext } from "../src/types";

export const secretKey = randomBytes(32);

// As ferramentas vivem em 2030: as tarefas que enfileiram nunca ficam elegíveis para os testes da
// fila e do runner, que rodam com relógios falsos no passado.
export const t0 = new Date("2030-05-10T12:00:00Z");

export interface FakeContext extends ToolContext {
  said: string[];
  transfers: string[];
  hangups: number;
  waits: { approvalId: string; timeoutMs: number }[];
  /** Avança o relógio falso. */
  advance(ms: number): void;
}

export async function createAgent(app: Db, organizationId: string, transferTo: string | null = null): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into agents (id, organization_id, name, engine, transfer_to_e164) values ($1, $2, 'Recepção', 'simulated', $3)", [id, organizationId, transferTo]),
  );
  return id;
}

/** Organização, agente e chamada novos, com um `ToolContext` falso por cima do banco de verdade. */
export async function createFixture(
  app: Db,
  label: string,
  options: { transferTo?: string; canTransfer?: boolean; onWait?: (approvalId: string, ctx: FakeContext) => Promise<ApprovalOutcome> } = {},
): Promise<FakeContext> {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, options.transferTo ?? null);
  const callId = await createCall(app, organizationId, t0);
  let now = t0;
  const ctx: FakeContext = {
    organizationId,
    agentId,
    callId,
    q: autoCommitOrgQuery(app, organizationId),
    clock: { now: () => now },
    said: [],
    transfers: [],
    hangups: 0,
    waits: [],
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
    telephony: {
      canTransfer: options.canTransfer ?? true,
      transfer: async (to) => {
        ctx.transfers.push(to);
      },
      hangup: async () => {
        ctx.hangups += 1;
      },
      pauseRecording: async () => "not_recording",
    },
    say: (text) => {
      ctx.said.push(text);
    },
    waitForApproval: async (approvalId, timeoutMs) => {
      ctx.waits.push({ approvalId, timeoutMs });
      if (!options.onWait) throw new Error("this fixture does not expect waitForApproval");
      return options.onWait(approvalId, ctx);
    },
  };
  return ctx;
}

export const eventsOf = (app: Db, callId: string): Promise<{ kind: string; payload: Record<string, unknown>; at: Date }[]> =>
  withSystem(app, (q) => q.many("select kind, payload, at from call_events where call_id = $1 order by id", [callId]));

export const notificationsOf = (app: Db, organizationId: string): Promise<{ id: string; channel: string; target: string | null; body: string; status: string; call_id: string | null }[]> =>
  withSystem(app, (q) => q.many("select id, channel, target, body, status, call_id from notifications where organization_id = $1 order by channel, target", [organizationId]));

export const tasksOf = (app: Db, organizationId: string): Promise<{ id: string; kind: string; payload: Record<string, unknown>; status: string; run_at: Date; call_id: string | null }[]> =>
  withSystem(app, (q) => q.many("select id, kind, payload, status, run_at, call_id from tasks where organization_id = $1 order by created_at, kind", [organizationId]));

export async function putSetting(app: Db, organizationId: string, key: string, value: unknown, secret = true): Promise<void> {
  await withSystem(app, (q) =>
    q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, $3, $4)", [organizationId, key, JSON.stringify(value), secret]),
  );
}

export async function putWhatsAppConnector(app: Db, organizationId: string, type: "deskcomm" | "webhook" = "webhook"): Promise<void> {
  await putSetting(app, organizationId, "whatsapp.connector", { type, url: "https://wa.example.com/send", token: encryptSecret("wa-token", secretKey) });
}

export async function createUser(app: Db, organizationId: string, whatsapp: string | null): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into users (id, organization_id, email, name, password_hash, role, whatsapp_e164) values ($1, $2, $3, 'Pessoa', 'x', 'operator', $4)", [
      id,
      organizationId,
      `${id}@example.com`,
      whatsapp,
    ]),
  );
  return id;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** `fetch` falso que grava cada requisição e responde o que o teste mandar. */
export function fakeFetch(respond: (request: RecordedRequest) => Response = () => new Response("ok")): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fake: typeof fetch = async (input, init) => {
    const request: RecordedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return respond(request);
  };
  return { fetch: fake, requests };
}

/** Resolvedor falso: todo nome é público, salvo os listados. */
export const fakeLookup =
  (table: Record<string, string[]> = {}) =>
  async (host: string): Promise<string[]> =>
    table[host] ?? ["93.184.216.34"];

/**
 * Dá à chamada da fixture um número e uma história: `calls` ligações anteriores do mesmo número e
 * uma pendência aberta para cada título. Para os testes da linha "Este número já ligou…".
 * `simulatedCalls`: simuladas com o mesmo número, que a linha não conta como ligação.
 */
export async function seedCallerHistory(
  app: Db,
  ctx: FakeContext,
  phone: string,
  history: { calls: number; openFollowUps: string[]; simulatedCalls?: number },
): Promise<string[]> {
  return withSystem(app, async (q) => {
    await q.exec("update calls set from_e164 = $2 where id = $1", [ctx.callId, phone]);
    const ids: string[] = [];
    for (let index = 0; index < history.calls; index += 1) {
      const id = randomUUID();
      await q.exec(
        "insert into calls (id, organization_id, agent_id, direction, channel, status, from_e164, summary, started_at, ended_at) values ($1, $2, $3, 'inbound', 'phone', 'completed', $4, $5, $6, $6)",
        [id, ctx.organizationId, ctx.agentId, phone, `Resumo ${index}: a pessoa contou um detalhe pessoal.`, new Date(t0.getTime() - (index + 1) * 86_400_000)],
      );
      ids.push(id);
    }
    for (let index = 0; index < (history.simulatedCalls ?? 0); index += 1) {
      await q.exec(
        "insert into calls (organization_id, agent_id, direction, channel, status, engine, from_e164, started_at, ended_at) values ($1, $2, 'inbound', 'simulated', 'completed', 'simulated', $3, $4, $4)",
        [ctx.organizationId, ctx.agentId, phone, new Date(t0.getTime() - (index + 1) * 3_600_000)],
      );
    }
    // Prazos em sequência: a linha cita as pendências na ordem do prazo.
    for (const [index, title] of history.openFollowUps.entries()) {
      await q.exec("insert into follow_ups (organization_id, call_id, caller_e164, title, due_at, created_at) values ($1, $2, $3, $4, $5, $6)", [
        ctx.organizationId,
        ids[0] ?? null,
        phone,
        title,
        new Date(t0.getTime() + (index + 1) * 60_000),
        t0,
      ]);
    }
    return ids;
  });
}
