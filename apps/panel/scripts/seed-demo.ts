// Semente da demonstração: uma organização com agente, linha, chamadas e uma chamada completa
// (falas, ferramenta, aprovação decidida, pendência com dono, transferência, custo), mais uma chamada em
// andamento com um pedido esperando resposta. Dados inventados.
//
//   DATABASE_URL=... SYSTEM_DATABASE_URL=... pnpm --filter @deskvoice/panel exec tsx scripts/seed-demo.ts
import { createDb, createFollowUp, hashPassword, recordEvent, systemClock, withOrg, withSystem, type CallEventKind, type OrgQuery } from "@deskvoice/core";

const EMAIL = "demo@deskvoice.test";
const PASSWORD = "deskvoice-demo";

const databaseUrl = process.env.DATABASE_URL;
const systemUrl = process.env.SYSTEM_DATABASE_URL;
if (!databaseUrl || !systemUrl) throw new Error("Set DATABASE_URL (deskvoice_app) and SYSTEM_DATABASE_URL (deskvoice_system) to seed the demo.");

const db = createDb(databaseUrl, systemUrl);
const now = systemClock.now();
const ago = (seconds: number): Date => new Date(now.getTime() - seconds * 1000);

async function id(q: OrgQuery, sql: string, params: unknown[]): Promise<string> {
  const row = await q.one<{ id: string }>(sql, params);
  if (!row) throw new Error(`Seed insert returned nothing: ${sql}`);
  return row.id;
}

type Step = [kind: CallEventKind, payload: object, secondsAfterStart: number];
async function timeline(q: OrgQuery, callId: string, startedAt: Date, steps: Step[]): Promise<void> {
  for (const [kind, payload, offset] of steps) await recordEvent(q, callId, kind, payload, new Date(startedAt.getTime() + offset * 1000));
}

try {
  // Só a criação da organização atravessa organizações; todo o resto roda preso a ela.
  const organizationId = await withSystem(db, async (q) => {
    if (await q.one("select 1 from users where email = $1", [EMAIL])) throw new Error(`The demo is already seeded: ${EMAIL} exists. Use a fresh database.`);
    return id(q, "insert into organizations (name) values ('Clínica Aurora (demonstração)') returning id", []);
  });
  const passwordHash = await hashPassword(PASSWORD);

  await withOrg(db, organizationId, async (q) => {
    const org = q.organizationId;
    const owner = await id(q, "insert into users (organization_id, email, name, password_hash, role, phone_e164) values ($1, $2, 'Marina Duarte', $3, 'owner', '+5531988880001') returning id", [org, EMAIL, passwordHash]);

    const agentSql = `insert into agents (organization_id, name, role_label, instructions, greeting, engine, tools, transfer_to_e164, enabled)
                      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`;
    const lia = await id(q, agentSql, [
      org,
      "Lia",
      "Recepção",
      "Você é a Lia, recepcionista da Clínica Aurora. Marque, remarque e confirme consultas. Não isente taxa nem dê desconto sem pedir aprovação a uma pessoa da equipe. Assunto financeiro é com o setor financeiro: transfira.",
      "Clínica Aurora, boa tarde. Aqui é a Lia. Como posso ajudar?",
      "simulated",
      ["request_approval", "transfer_to_human", "notify_human", "create_task", "end_call"],
      "+5531988887777",
      true,
    ]);
    // As pendências que a Lia abre ficam com a Marina ("Dono das pendências", na tela do agente).
    await q.exec("update agents set follow_up_owner_user_id = $2 where id = $1", [lia, owner]);
    await id(q, agentSql, [org, "Caio", "Confirmação de consultas", "Você confirma as consultas do dia seguinte.", "Olá, aqui é o Caio, da Clínica Aurora.", "gemini-live", ["end_call", "notify_human"], null, false]);

    const trunk = await id(q, "insert into trunks (organization_id, name, host, username, auth_mode, caller_id_e164) values ($1, 'Operadora Exemplo', 'sip.exemplo.com.br', '553132221100', 'register', '+553132221100') returning id", [org]);
    await id(q, "insert into phone_numbers (organization_id, trunk_id, e164, agent_id) values ($1, $2, '+553132221100', $3) returning id", [org, trunk, lia]);

    const callSql = `insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, end_reason, engine, started_at, answered_at, ended_at, cost_cents, summary)
                     values ($1, $2, 'inbound', 'phone', $3, '+553132221100', $4, $5, $6, $7, $8, $9, $10, $11) returning id`;
    const usageSql = "insert into usage_ledger (organization_id, call_id, engine, seconds, input_tokens, output_tokens, cost_cents, at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id";

    // 1. A chamada completa: remarcação com isenção de taxa aprovada, tarefa e transferência.
    const started = ago(42 * 60);
    const full = await id(q, callSql, [
      org, lia, "+5531999998888", "transferred", "transferred", "gemini-live", started, new Date(started.getTime() + 2000), new Date(started.getTime() + 214_000), 18,
      "Paciente Helena pediu para remarcar a consulta de quinta para segunda às 14h. A isenção da taxa de remarcação foi aprovada por Marina Duarte. Ficou agendado o envio da confirmação por WhatsApp. No fim, a ligação foi transferida ao financeiro para tratar de um reembolso.",
    ]);
    const approval = await id(q, "insert into approvals (organization_id, call_id, question, context, status, default_on_timeout, expires_at, decided_by, decided_at) values ($1, $2, $3, $4, 'approved', 'denied', $5, $6, $7) returning id", [
      org, full, "Posso isentar a taxa de remarcação da Helena?", JSON.stringify({ text: "Paciente há 3 anos. Remarca pela primeira vez e avisou com 2 dias de antecedência. A taxa é de R$ 40,00." }),
      new Date(started.getTime() + 118_000), owner, new Date(started.getTime() + 81_000),
    ]);
    await timeline(q, full, started, [
      ["call_started", { from: "+5531999998888", to: "+553132221100", direction: "inbound" }, 0],
      ["call_answered", {}, 2],
      ["recording_notice", { text: "Esta ligação é atendida por uma assistente virtual e a conversa fica registrada." }, 3],
      ["transcript_agent", { text: "Clínica Aurora, boa tarde. Aqui é a Lia. Como posso ajudar?" }, 9],
      ["transcript_user", { text: "Oi, Lia. É a Helena. Eu tenho consulta na quinta, mas vou precisar remarcar." }, 16],
      ["transcript_agent", { text: "Claro, Helena. Tenho segunda às 14h ou terça às 9h30. Qual fica melhor?" }, 24],
      ["transcript_user", { text: "Segunda às 14h. E a taxa de remarcação, tem como não cobrar dessa vez?" }, 33],
      ["tool_called", { name: "request_approval", args: { question: "Posso isentar a taxa de remarcação da Helena?", context: "Paciente há 3 anos. Remarca pela primeira vez e avisou com 2 dias de antecedência. A taxa é de R$ 40,00.", default_on_timeout: "denied", timeout_seconds: 60 } }, 57],
      ["approval_requested", { approvalId: approval, question: "Posso isentar a taxa de remarcação da Helena?", context: "Paciente há 3 anos. Remarca pela primeira vez e avisou com 2 dias de antecedência. A taxa é de R$ 40,00.", defaultOnTimeout: "denied", expiresAt: new Date(started.getTime() + 118_000).toISOString() }, 58],
      ["transcript_agent", { text: "Um instante, por favor. Vou conferir isso com um responsável." }, 59],
      ["approval_decided", { approvalId: approval, outcome: "approved", decision: "approved" }, 81],
      ["tool_result", { name: "request_approval", ok: true, message: "Aprovado por uma pessoa da equipe. Diga a quem está na linha que foi aprovado e siga." }, 82],
      ["transcript_agent", { text: "Helena, consegui: a taxa está isenta. Sua consulta ficou para segunda às 14h." }, 88],
      // Os argumentos de create_task são texto sobre quem ligou: a linha do tempo não os guarda.
      ["tool_called", { name: "create_task", args: { omitted: "personal_text" } }, 96],
    ]);
    // A pendência nasce pelo ponto de escrita do produto, com o dono do agente e o evento na linha do tempo.
    await createFollowUp(
      q,
      { callId: full, agentId: lia, title: "Enviar confirmação da consulta de segunda, 14h, por WhatsApp", details: "Helena remarcou de quinta para segunda às 14h, com a taxa isenta.", dueAt: new Date(started.getTime() + 18 * 3600_000) },
      new Date(started.getTime() + 97_000),
    );
    await timeline(q, full, started, [
      ["tool_result", { name: "create_task", ok: true, message: "Pendência registrada para a equipe. Diga à pessoa que ficou anotado, sem prometer horário que não foi combinado." }, 97],
      ["transcript_user", { text: "Perfeito. Só mais uma coisa: quero ver um reembolso do mês passado." }, 108],
      ["transcript_agent", { text: "Isso é com o financeiro. Vou transferir você agora, tudo bem?" }, 116],
      ["tool_called", { name: "transfer_to_human", args: { reason: "Reembolso de mensalidade do mês passado", summary: "Helena remarcou a consulta para segunda, 14h, com taxa isenta. Agora quer tratar de um reembolso." } }, 121],
      ["human_notified", { message: "Lia está transferindo uma ligação: Helena quer tratar de um reembolso do mês passado.", urgency: "normal", channels: ["painel", "whatsapp"] }, 122],
      ["transfer_started", { to: "+5531988887777", reason: "Reembolso de mensalidade do mês passado", summary: "Helena remarcou a consulta para segunda, 14h, com taxa isenta." }, 123],
      ["tool_result", { name: "transfer_to_human", ok: true, message: "Transferência iniciada." }, 124],
      ["transfer_completed", {}, 131],
      ["call_ended", { reason: "transferred" }, 214],
      ["task_finished", { kind: "summarize_call", outcome: "done", attempt: 1 }, 219],
    ]);
    await id(q, usageSql, [org, full, "gemini-live", 212, 41_000, 9_800, 18, new Date(started.getTime() + 214_000)]);
    await id(q, "insert into notifications (organization_id, call_id, channel, body, status, created_at) values ($1, $2, 'panel', $3, 'sent', $4) returning id", [
      org, full, "Lia transferiu uma ligação para o financeiro: Helena quer tratar de um reembolso do mês passado.", new Date(started.getTime() + 122_000),
    ]);

    // 2. Uma chamada em andamento, com um pedido esperando resposta: é o que acende a tela.
    const liveStart = ago(84);
    const live = await id(q, callSql, [org, lia, "+5531987654321", "in_progress", null, "gemini-live", liveStart, new Date(liveStart.getTime() + 2000), null, 4, null]);
    const pending = await id(q, "insert into approvals (organization_id, call_id, question, context, default_on_timeout, expires_at) values ($1, $2, $3, $4, 'denied', $5) returning id", [
      org, live, "Posso encaixar o Rafael hoje às 17h40, depois do último horário?", JSON.stringify({ text: "Ele está com dor desde ontem e a agenda de hoje está cheia. A doutora atende até 17h30." }), new Date(now.getTime() + 4 * 60_000),
    ]);
    await timeline(q, live, liveStart, [
      ["call_started", { from: "+5531987654321", to: "+553132221100", direction: "inbound" }, 0],
      ["call_answered", {}, 2],
      ["recording_notice", { text: "Esta ligação é atendida por uma assistente virtual e a conversa fica registrada." }, 3],
      ["transcript_agent", { text: "Clínica Aurora, boa tarde. Aqui é a Lia. Como posso ajudar?" }, 9],
      ["transcript_user", { text: "Boa tarde. Estou com muita dor desde ontem. Tem algum horário ainda hoje?" }, 18],
      ["transcript_agent", { text: "Sinto muito, Rafael. A agenda de hoje está cheia, mas vou ver se consigo um encaixe." }, 27],
      ["tool_called", { name: "request_approval", args: { question: "Posso encaixar o Rafael hoje às 17h40, depois do último horário?", default_on_timeout: "denied", timeout_seconds: 300 } }, 40],
      ["approval_requested", { approvalId: pending, question: "Posso encaixar o Rafael hoje às 17h40, depois do último horário?", context: "Ele está com dor desde ontem e a agenda de hoje está cheia. A doutora atende até 17h30.", defaultOnTimeout: "denied", expiresAt: new Date(now.getTime() + 4 * 60_000).toISOString() }, 41],
      ["transcript_agent", { text: "Um instante, por favor. Vou conferir isso com um responsável." }, 42],
    ]);

    // 3. Histórico variado, para o filtro por estado e a tela de custos.
    const history: Array<[from: string, status: string, reason: string, engine: string, hoursAgo: number, seconds: number, cents: number, summary: string | null, steps: Step[]]> = [
      ["+5531991112222", "completed", "caller_hangup", "gemini-live", 3, 96, 8, "Confirmou a consulta de amanhã às 10h.", [["transcript_user", { text: "Só queria confirmar minha consulta de amanhã." }, 8], ["transcript_agent", { text: "Confirmada: amanhã às 10h, com a doutora Paula." }, 15], ["call_ended", { reason: "caller_hangup" }, 96]]],
      ["+5531993334444", "failed", "engine_failed", "openai-realtime", 26, 41, 21, null, [["transcript_user", { text: "Alô? Queria saber o valor da consulta." }, 7], ["engine_failed", { reason: "A conexão com o provedor fechou no meio da chamada." }, 38], ["call_ended", { reason: "engine_failed" }, 41]]],
      ["+5531995556666", "refused", "engine_not_configured", "openai-realtime", 49, 0, 0, null, [["call_refused", { reason: "engine_not_configured" }, 0]]],
      ["+5531997778888", "completed", "agent_ended", "gemini-live", 73, 188, 15, "Marcou a primeira consulta para sexta às 16h.", [["transcript_user", { text: "Quero marcar uma primeira consulta." }, 9], ["transcript_agent", { text: "Tenho sexta às 16h. Pode ser?" }, 17], ["call_ended", { reason: "agent_ended" }, 188]]],
      ["+5531992223333", "completed", "caller_hangup", "gemini-live", 120, 264, 22, "Tirou dúvidas sobre convênios aceitos.", [["call_ended", { reason: "caller_hangup" }, 264]]],
    ];
    for (const [from, status, reason, engine, hoursAgo, seconds, cents, summary, steps] of history) {
      const at = ago(hoursAgo * 3600);
      const ended = new Date(at.getTime() + seconds * 1000);
      const call = await id(q, callSql, [org, lia, from, status, reason, engine, at, status === "refused" ? null : new Date(at.getTime() + 2000), ended, cents, summary]);
      await timeline(q, call, at, [["call_started", { from, to: "+553132221100", direction: "inbound" }, 0], ...(status === "refused" ? [] : ([["call_answered", {}, 2]] satisfies Step[])), ...steps]);
      if (cents > 0) await id(q, usageSql, [org, call, engine, seconds, seconds * 190, seconds * 46, cents, ended]);
    }

    await q.exec("insert into do_not_call (organization_id, e164, reason) values ($1, '+5531990001111', 'Pediu para não receber ligações')", [org]);
  });

  process.stdout.write(`Demo seeded. Sign in with ${EMAIL} / ${PASSWORD}\n`);
} finally {
  await db.close();
}
