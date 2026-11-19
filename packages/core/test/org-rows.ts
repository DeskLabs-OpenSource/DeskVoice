// As linhas de teste de uma organização, uma por tabela com `organization_id`. Saíram de
// `isolation.db.test.ts` para o teste da cascata (`organization-cascade.db.test.ts`) montar as
// mesmas linhas. A regra continua lá: tabela nova sem fábrica reprova o teste de isolamento, e a
// fábrica dela passa a valer também para a cascata.
import { randomUUID } from "node:crypto";
import { createAccount } from "../src/accounts";
import type { Db, OrgQuery } from "../src/types";
import { withSystem } from "../src/with-org";

export type Row = Record<string, unknown>;
/** Monta uma linha válida da tabela para a organização, apontando para linhas já criadas dela. */
export type Factory = (organizationId: string, parents: Record<string, Row>) => Row;

const at = new Date("2026-01-15T12:00:00Z");
const unique = (prefix: string): string => `${prefix}-${randomUUID()}`;

/**
 * A conta não pertence a organização nenhuma e só o papel de sistema a cria: a fábrica de `users`
 * pega uma destas, feitas antes. Cada vínculo precisa de uma conta própria (`users_one_membership_idx`
 * e o e-mail único).
 */
export async function spareAccounts(app: Db, count: number, file: string): Promise<() => string> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await withSystem(app, (q) => createAccount(q, { email: `${unique("account")}@example.com`, passwordHash: "x" }));
    if (!id) throw new Error("could not create a test account");
    ids.push(id);
  }
  return () => {
    const id = ids.pop();
    if (!id) throw new Error(`${file} ran out of spare accounts: create more`);
    return id;
  };
}

/**
 * Uma fábrica por tabela com `organization_id`, em ordem de dependência. Tabela nova sem fábrica
 * reprova `isolation.db.test.ts`: é assim que ela é obrigada a entrar no teste de isolamento.
 */
export function organizationFactories(nextAccount: () => string): Record<string, Factory> {
  return {
    users: (organization_id) => ({ organization_id, account_id: nextAccount(), email: `${unique("user")}@example.com`, name: "User", role: "owner" }),
    sessions: (organization_id, p) => ({ organization_id, user_id: p.users?.id, account_id: p.users?.account_id, token_hash: unique("token"), expires_at: at }),
    // O vínculo de suporte de verdade nasce por `startSupportAccess`; aqui basta um vínculo da organização.
    support_accesses: (organization_id, p) => ({
      organization_id,
      user_id: p.users?.id,
      reason: "Ajuda com a linha da operadora",
      started_at: at,
      expires_at: new Date(at.getTime() + 15 * 60_000),
    }),
    invites: (organization_id, p) => ({ organization_id, email: `${unique("invite")}@example.com`, name: "Invited", role: "operator", token_hash: unique("invite-token"), expires_at: at, created_by: p.users?.id }),
    settings: (organization_id) => ({ organization_id, key: unique("key"), value: { on: true } }),
    trunks: (organization_id) => ({ organization_id, name: "Trunk", host: "sip.example.com", auth_mode: "register" }),
    analysts: (organization_id, p) => ({
      organization_id,
      name: unique("analyst").slice(0, 40),
      decision_model: "jev",
      provider_confirmed_by: p.users?.id,
      provider_confirmed_at: at,
      created_at: at,
      updated_at: at,
    }),
    agents: (organization_id, p) => ({ organization_id, name: "Agent", engine: "simulated", analyst_id: p.analysts?.id }),
    // O menu por teclas (#223). O anúncio vai junto: é o `bytea` que a RLS tem de esconder da outra organização.
    ivr_menus: (organization_id) => ({ organization_id, name: "Menu", prompt_audio: Buffer.alloc(16), prompt_audio_ms: 1, created_at: at, updated_at: at }),
    // O número atende o menu (`mode = 'ivr'`): a chave dele para `ivr_menus` é `on delete restrict`, e a
    // cascata da exclusão de organização tem de passar por ela (nota da revisora no #480).
    phone_numbers: (organization_id, p) => ({
      organization_id,
      trunk_id: p.trunks?.id,
      e164: `+55${Math.floor(1e10 + Math.random() * 9e10)}`,
      agent_id: p.agents?.id,
      mode: "ivr",
      ivr_menu_id: p.ivr_menus?.id,
    }),
    ivr_options: (organization_id, p) => ({ organization_id, menu_id: p.ivr_menus?.id, digit: "1", label: "Atendente", action: "agent", agent_id: p.agents?.id }),
    calls: (organization_id, p) => ({ organization_id, agent_id: p.agents?.id, direction: "inbound", channel: "phone", status: "ringing", started_at: at }),
    call_events: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, at, kind: "call_started", payload: {} }),
    approvals: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, question: "Pode?", default_on_timeout: "denied", expires_at: at }),
    tasks: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, kind: "isolation_probe", payload: {}, status: "done" }),
    call_backs: (organization_id, p) => ({ organization_id, origin_call_id: p.calls?.id, to_e164: "+5531999990000", attempt: 1, due_at: at, created_at: at }),
    follow_ups: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, title: "Retornar", owner_user_id: p.users?.id, due_at: at, created_at: at }),
    notifications: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, follow_up_id: p.follow_ups?.id, channel: "panel", body: "Aviso" }),
    caller_notes: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, caller_e164: "+5531999990000", text: "Nota", created_at: at }),
    outbound_policy: (organization_id) => ({ organization_id }),
    do_not_call: (organization_id) => ({ organization_id, e164: `+55${Math.floor(1e10 + Math.random() * 9e10)}` }),
    usage_ledger: (organization_id, p) => ({ organization_id, call_id: p.calls?.id, engine: "simulated", at }),
    // Encerrado de propósito: só cabe um pedido ABERTO na instalação inteira, e aqui há duas organizações.
    update_requests: (organization_id, p) => ({ organization_id, requested_by: p.users?.id, status: "succeeded", from_version: "0.1.0", target_version: "0.2.0" }),
    update_agent_status: (organization_id) => ({ organization_id, last_seen_at: at, announced_version: "0.1.0" }),
    whatsapp_sessions: (organization_id) => ({ organization_id, session_name: unique("session") }),
    whatsapp_call_sessions: (organization_id) => ({ organization_id, session_name: unique("call-session") }),
    organization_events: (organization_id, p) => ({ organization_id, at, kind: "isolation_probe", actor_user_id: p.users?.id, payload: {} }),
    share_links: (organization_id, p) => ({
      organization_id,
      call_id: p.calls?.id,
      token_hash: unique("share-token"),
      kind: "recording",
      expires_at: at,
      max_uses: 10,
      created_by: p.users?.id,
      created_at: at,
    }),
    // Inserida pelo papel de sistema: a organização não escreve aqui (`SYSTEM_WRITTEN_TABLES`).
    organization_limits: (organization_id) => ({ organization_id, max_trunks: 2, max_agents: 5 }),
  };
}

export const ident = (name: string): string => `"${name.replaceAll('"', '""')}"`;

export async function insert(q: OrgQuery, table: string, row: Row): Promise<Row> {
  const columns = Object.keys(row);
  const inserted = await q.one(
    `insert into ${ident(table)} (${columns.map(ident).join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    Object.values(row),
  );
  if (!inserted) throw new Error(`insert into ${table} returned no row`);
  return inserted;
}
