// `pnpm demo`: uma chamada inteira no terminal, sem tronco, sem chave de IA e sem Asterisk.
// Sobe um Postgres descartável (o mesmo dos testes de banco), roda a chamada simulada em processo
// e imprime a linha do tempo que o painel mostraria.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { systemClock, withOrg, type Db } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { loadEngines } from "@deskvoice/voice-engine";
import { createOrganization, openTestDbs } from "../../../../packages/core/test/helpers";
import startTestDatabase from "../../../../scripts/test-db-setup";
import { createApprovalWaiter } from "../approvals";
import { messageOf } from "../log";
import { startSimulatedCall } from "../simulate";

const APPROVAL_DELAY_MS = 2500;
const TRANSFER_TO = "+5531988887777";

const print = (line = ""): void => void process.stdout.write(`${line}\n`);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function describeEvent(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case "call_started":
      return "A ligação chegou";
    case "call_answered":
      return `O agente atendeu (motor ${text(payload.engine)})`;
    case "recording_notice":
      return `Aviso de gravação: ${text(payload.text)}`;
    case "transcript_user":
      return `Quem ligou: ${text(payload.text)}`;
    case "transcript_agent":
      return `Agente:     ${text(payload.text)}`;
    case "tool_called":
      return `Ferramenta ${text(payload.name)} chamada`;
    case "tool_result":
      return `Ferramenta ${text(payload.name)} ${payload.ok ? "concluída" : "falhou"}`;
    case "human_notified":
      return `Equipe avisada: ${text(payload.message)}`;
    case "approval_requested":
      return `Aprovação pedida a uma pessoa: ${text(payload.question)} (sem resposta, vale ${payload.defaultOnTimeout === "approved" ? "aprovar" : "negar"})`;
    case "approval_decided":
      return `Aprovação decidida: ${{ approved: "aprovado", denied: "negado", expired: "ninguém respondeu no prazo" }[text(payload.outcome)] ?? text(payload.outcome)}`;
    case "transfer_started":
      return `Transferindo para ${text(payload.to)}: ${text(payload.reason)}`;
    case "call_ended":
      return `Chamada encerrada (${text(payload.status)}, motivo ${text(payload.reason)})`;
    case "task_queued":
      return `Tarefa deixada para depois da chamada: ${text(payload.kind)}`;
    default:
      return kind;
  }
}

async function run(db: Db): Promise<void> {
  const organizationId = await createOrganization(db, "Clínica Bem Viver (demonstração)");
  const agent = await withOrg(db, organizationId, (q) =>
    q.one<{ id: string }>(
      `insert into agents (organization_id, name, role_label, instructions, greeting, engine, tools, transfer_to_e164)
       values ($1, 'Lia', 'Recepção', 'Você é a Lia, da recepção da Clínica Bem Viver.', 'Clínica Bem Viver, bom dia. Aqui é a Lia, assistente virtual da recepção. Como posso ajudar?', 'simulated', $2, $3)
       returning id`,
      [organizationId, ["notify_human", "request_approval", "transfer_to_human", "end_call"], TRANSFER_TO],
    ),
  );
  if (!agent) throw new Error("Demo agent was not created");

  const approvals = await createApprovalWaiter(db);
  try {
    const [engines, tools] = await Promise.all([loadEngines(), loadTools()]);
    // A chave só decifra segredos de `settings`, e a demonstração não guarda nenhum.
    const started = await startSimulatedCall({ db, clock: systemClock, engines, tools, secretKey: randomBytes(32), approvals }, { organizationId, agentId: agent.id });
    if (!("callId" in started)) throw new Error(`${started.code}: ${started.message}`);
    const { callId, session } = started;
    print(`Chamada simulada ${callId} em andamento: motor simulado, sem telefonia.`);

    // No produto, é aqui que alguém abre o painel e decide. A demonstração decide sozinha.
    const decide = (async (): Promise<void> => {
      for (;;) {
        const pending = await withOrg(db, organizationId, (q) => q.one<{ id: string; question: string }>("select id, question from approvals where call_id = $1 and status = 'pending'", [callId]));
        if (pending) {
          print(`O agente pediu aprovação ("${pending.question}") e está esperando com a pessoa na linha.`);
          print(`A demonstração aprova sozinha em ${APPROVAL_DELAY_MS / 1000} s; no painel, quem decide é uma pessoa.`);
          await sleep(APPROVAL_DELAY_MS);
          await withOrg(db, organizationId, (q) => q.exec("update approvals set status = 'approved', decided_at = $2 where id = $1 and status = 'pending'", [pending.id, systemClock.now()]));
          return;
        }
        await sleep(100);
      }
    })();
    const outcome = await session.done;
    await decide;

    const timeline = await withOrg(db, organizationId, async (q) => ({
      events: await q.many<{ at: Date; kind: string; payload: Record<string, unknown> }>("select at, kind, payload from call_events where call_id = $1 order by id", [callId]),
      tasks: await q.many<{ kind: string; status: string }>("select kind, status from tasks where call_id = $1 order by created_at, kind", [callId]),
      notifications: await q.many<{ body: string }>("select body from notifications where call_id = $1 order by created_at", [callId]),
      usage: await q.one<{ seconds: number; cost_cents: number }>("select coalesce(sum(seconds), 0)::int as seconds, coalesce(sum(cost_cents), 0)::int as cost_cents from usage_ledger where call_id = $1", [callId]),
    }));
    const start = timeline.events[0]?.at.getTime() ?? 0;

    print();
    print("Linha do tempo da chamada");
    print("-------------------------");
    for (const event of timeline.events) print(`+${((event.at.getTime() - start) / 1000).toFixed(1).padStart(5)} s  ${describeEvent(event.kind, event.payload)}`);
    print();
    print(`Desfecho: ${outcome.status} (${outcome.endReason})`);
    print(`Custo: US$ ${(outcome.costCents / 100).toFixed(2)} em ${timeline.usage?.seconds ?? 0} s de áudio medidos (o motor simulado não cobra; com um motor real o valor sai do preço dele).`);
    print(`Avisos no painel: ${timeline.notifications.length}`);
    print(`Tarefas na fila: ${timeline.tasks.map((task) => `${task.kind} (${task.status})`).join(", ")}`);
    print("O resumo da chamada (summarize_call) é escrito pelo processo de rotinas, que esta demonstração não sobe.");
  } finally {
    await approvals.close();
  }
}

try {
  execFileSync("docker", ["info"], { stdio: "ignore" });
} catch (error) {
  print(`A demonstração precisa do Docker para subir um banco descartável, e o Docker não respondeu (${messageOf(error).split("\n")[0]}).`);
  print("Instale ou inicie o Docker e rode `pnpm demo` de novo.");
  process.exit(1);
}

print("Subindo um Postgres descartável e aplicando as migrations...");
const stopDatabase = await startTestDatabase();
const { app, owner } = openTestDbs();
try {
  await run(app);
} catch (error) {
  print(`A demonstração falhou: ${messageOf(error)}`);
  process.exitCode = 1;
} finally {
  await app.close();
  await owner.close();
  await stopDatabase();
  print("Banco descartável removido.");
}
