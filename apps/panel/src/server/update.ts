import { createHash, timingSafeEqual } from "node:crypto";
import { enqueueTask, withOrg, withSystem, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import type { ServerDeps } from "./context";

/**
 * Atualizar pela tela. O painel roda em contêiner e nunca toca no Docker da máquina: ele só
 * registra o pedido. Quem atualiza é o agente do kit (`install/agent.sh`), que passa a cada
 * minuto, anuncia a versão instalada e recebe de volta dois booleanos: se há atualização pedida, e
 * se esta instalação quer o serviço de WhatsApp. Nenhum dos dois é comando, versão, imagem ou endereço.
 *
 * A atualização é da instalação, não de uma organização. Por isso o que está aqui usa
 * `withSystem`: ouvir o agente e vencer pedido parado valem para todas.
 */

/** Pedido que o agente nunca pegou vence aqui: é sinal de que o agente não está passando. */
export const PICKUP_MINUTES = 15;
/** Pedido que o agente aceitou e não concluiu vence aqui, e outro pode ser feito. */
export const RUN_MINUTES = 30;
/** O agente passa a cada minuto; calado por mais que isto, a tela diz que ele não responde. */
export const AGENT_SILENT_MINUTES = 5;

export const REQUEST_COLUMNS = `id, status, from_version as "fromVersion", target_version as "targetVersion", to_version as "toVersion", detail, output_kept as "outputKept",
  requested_at as "requestedAt", accepted_at as "acceptedAt", finished_at as "finishedAt"`;

export const WHATSAPP_SERVICE_STATES = ["absent", "running", "failed"] as const;
/** Por que ligar ou desligar o serviço falhou: a imagem não baixou, o serviço não subiu, o contêiner não saiu. */
export const WHATSAPP_SERVICE_REASONS = ["no_disk", "pull_failed", "start_failed", "remove_failed"] as const;
/** O que acompanha o estado sem ser falha: instalado com pouca memória; removido, mas a imagem ficou no disco. */
export const WHATSAPP_SERVICE_WARNINGS = ["low_memory", "image_kept"] as const;
const megabytes = z.number().int().min(0).max(100_000_000);

const DETAIL_MAX = 8000;
const short = (max: number) => z.string().transform((value) => value.slice(0, max));

/**
 * O que o agente manda. Quem fala é sempre o agente da versão ANTERIOR à do painel (é ele que
 * roda a atualização e relata o fim dela para o painel novo): campo novo entra opcional, e campo
 * existente nunca muda de sentido. Os textos são cortados em vez de recusados, para um relato
 * grande demais não ficar preso sendo reenviado para sempre.
 */
export const agentReport = z.object({
  version: short(40),
  /** Para qual versão o servidor iria agora. Vazio ou ausente = já está na mais recente que ele enxerga. */
  target: short(40).optional(),
  result: z
    .object({
      outcome: z.enum(["succeeded", "nothing_to_do", "rolled_back", "failed"]),
      toVersion: short(40).optional(),
      /** O agente guardou a saída inteira no servidor, em deploy/agent/last-update.log. Ausente = não guardou. */
      outputKept: z.boolean().optional(),
      detail: z.string().default("").transform((value) => value.slice(-DETAIL_MAX)),
    })
    .optional(),
  lastFailure: z.object({ at: z.string(), detail: short(500) }).optional(),
  /**
   * O estado do serviço de WhatsApp no servidor, em códigos fechados. Ausente = agente de uma
   * versão que não cuida do serviço. Valor que este painel não conhece vale como ausente: um
   * relato do WhatsApp nunca pode fazer o relato da atualização ser recusado.
   */
  whatsapp: z
    .object({
      state: z.enum(WHATSAPP_SERVICE_STATES),
      reason: z.enum(WHATSAPP_SERVICE_REASONS).optional().catch(undefined),
      warning: z.enum(WHATSAPP_SERVICE_WARNINGS).optional().catch(undefined),
      // Só números: quanto havia de disco e quanto o serviço pede, quando faltou espaço.
      freeDiskMb: megabytes.optional().catch(undefined),
      neededDiskMb: megabytes.optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});
export type AgentReport = z.output<typeof agentReport>;

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Confere o segredo do agente em tempo constante. Sem segredo configurado, ninguém passa. */
export function isAgent(request: Request, deps: ServerDeps): boolean {
  if (deps.agentToken === "") return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(digest(given), digest(deps.agentToken));
}

const STARTED = "A atualização do DeskVoice começou. O sistema fica fora do ar por alguns minutos, e as chamadas em andamento caem. O resultado aparece em Configurações.";
const FINISHED: Record<NonNullable<AgentReport["result"]>["outcome"] | "expired" | "superseded", (version: string) => string> = {
  succeeded: (version) => `A atualização do DeskVoice terminou: o sistema está na versão ${version}.`,
  nothing_to_do: () => "O pedido de atualização terminou sem mudança: o servidor já estava na versão publicada mais recente.",
  rolled_back: () => "A atualização do DeskVoice não foi aplicada: o sistema segue na versão anterior e está respondendo. O motivo está em Configurações.",
  failed: () => "A atualização do DeskVoice falhou e o sistema pode não ter voltado inteiro. Veja o que aconteceu em Configurações e confira o servidor.",
  superseded: () => "O pedido de atualização do DeskVoice não foi executado: saiu uma versão mais nova depois que ele foi feito, e ninguém confirmou essa. Nada foi alterado. Veja as notas em Configurações e peça de novo.",
  expired: () => "O pedido de atualização do DeskVoice venceu sem resultado. Veja em Configurações o que aconteceu; outro pedido já pode ser feito.",
};

interface Notice {
  body: string;
}

const WHATSAPP_SERVICE_NOTICE = {
  running: "O serviço de WhatsApp está instalado neste servidor. Conecte um número em Configurações.",
  failed: "O servidor não conseguiu instalar ou remover o serviço de WhatsApp. Ele tenta de novo em alguns minutos; o motivo está em Configurações.",
  absent: "O serviço de WhatsApp foi removido deste servidor.",
};

/** Vence os pedidos parados, de qualquer organização. Devolve os avisos a deixar no painel. */
async function expireStale(q: OrgQuery, now: Date): Promise<Notice[]> {
  const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);
  const expired = await q.exec(
    `update update_requests set status = 'expired', finished_at = $1
      where (status = 'requested' and requested_at < $2) or (status = 'running' and accepted_at < $3)`,
    [now, minutesAgo(PICKUP_MINUTES), minutesAgo(RUN_MINUTES)],
  );
  return expired > 0 ? [{ body: FINISHED.expired("") }] : [];
}

/** O aviso vai para o painel de toda organização: a atualização derruba o sistema de todas. */
async function leaveNotices(deps: ServerDeps, notices: Notice[]): Promise<void> {
  if (notices.length === 0) return;
  const now = deps.clock.now();
  const organizations = await withSystem(deps.db, (q) => q.many<{ id: string }>("select id from organizations"));
  for (const { id } of organizations) {
    await withOrg(deps.db, id, async (q) => {
      for (const { body } of notices) {
        const row = await q.one<{ id: string }>("insert into notifications (organization_id, channel, body, created_at) values ($1, 'panel', $2, $3) returning id", [id, body, now]);
        if (row) await enqueueTask(q, { kind: "deliver_notification", payload: { notificationId: row.id }, runAt: now });
      }
    });
  }
}

/** Para as rotas da tela: antes de ler ou de pedir, o que venceu vira falha visível. */
export async function expireStaleUpdates(deps: ServerDeps): Promise<void> {
  await leaveNotices(deps, await withSystem(deps.db, (q) => expireStale(q, deps.clock.now())));
}

/**
 * Uma passada do agente: grava que ele falou, fecha o pedido com o resultado que ele trouxe e
 * diz se há pedido esperando e se o serviço de WhatsApp é querido. A resposta são só os dois
 * booleanos: nada do que o painel devolve é comando, versão, imagem ou endereço. Para qual versão
 * ir, o agente descobre sozinho, nas tags do repositório; a imagem do WhatsApp é a do Compose dele.
 */
export async function agentCheckIn(deps: ServerDeps, report: AgentReport): Promise<{ update: boolean; whatsapp: boolean }> {
  const now = deps.clock.now();
  const failureAt = report.lastFailure ? new Date(report.lastFailure.at) : null;
  const target = report.target || null;
  const outcome = await withSystem(deps.db, async (q) => {
    const notices: Notice[] = [];
    // O serviço de WhatsApp é da instalação: basta uma organização querer. É o segundo booleano.
    const wanted = (await q.one<{ wanted: boolean }>("select exists (select 1 from whatsapp_sessions where service_wanted) as wanted"))?.wanted ?? false;
    const before = await q.one<{ service: string | null }>("select whatsapp_service as service from update_agent_status limit 1");
    const service = report.whatsapp?.state ?? null;
    const reason = (service === "failed" && report.whatsapp?.reason) || null;
    const noDisk = reason === "no_disk";
    // Só o que mudou vira aviso, e "fora" só é notícia para quem tinha o serviço de pé.
    if (service !== null && service !== (before?.service ?? null) && (service !== "absent" || before?.service === "running")) notices.push({ body: WHATSAPP_SERVICE_NOTICE[service] });
    await q.exec(
      `insert into update_agent_status (organization_id, last_seen_at, announced_version, last_failure_at, last_failure_detail, target_version, whatsapp_service, whatsapp_service_reason,
                                        whatsapp_service_warning, whatsapp_service_free_mb, whatsapp_service_needed_mb)
       select id, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10 from organizations
       on conflict (organization_id) do update set last_seen_at = excluded.last_seen_at, announced_version = excluded.announced_version,
         target_version = excluded.target_version, whatsapp_service = excluded.whatsapp_service, whatsapp_service_reason = excluded.whatsapp_service_reason,
         whatsapp_service_warning = excluded.whatsapp_service_warning, whatsapp_service_free_mb = excluded.whatsapp_service_free_mb,
         whatsapp_service_needed_mb = excluded.whatsapp_service_needed_mb,
         last_failure_at = coalesce(excluded.last_failure_at, update_agent_status.last_failure_at),
         last_failure_detail = coalesce(excluded.last_failure_detail, update_agent_status.last_failure_detail)`,
      [now, report.version, failureAt && (Number.isNaN(failureAt.getTime()) ? now : failureAt), report.lastFailure?.detail ?? null, target, service, reason, report.whatsapp?.warning ?? null, noDisk ? (report.whatsapp?.freeDiskMb ?? null) : null, noDisk ? (report.whatsapp?.neededDiskMb ?? null) : null],
    );

    if (report.result) {
      // O resultado é do último pedido que o agente aceitou. Se ele já tinha vencido, vale o que
      // de fato aconteceu: uma atualização que terminou depois do prazo não fica como "venceu".
      const closed = await q.exec(
        `update update_requests set status = $1, finished_at = $2, to_version = $3, detail = $4, output_kept = $5
          where id = (select id from update_requests where accepted_at is not null and status in ('running', 'expired') order by accepted_at desc limit 1)`,
        [report.result.outcome, now, report.result.toVersion ?? null, report.result.detail, report.result.outputKept ?? false],
      );
      if (closed > 0) notices.push({ body: FINISHED[report.result.outcome](report.result.toVersion ?? report.version) });
    }

    notices.push(...(await expireStale(q, now)));
    // Quem compara é o painel, para o agente continuar recebendo só o booleano. O pedido guarda a
    // versão que a pessoa confirmou; se o servidor agora iria para outra, o pedido termina aqui e
    // a resposta é "não". Sem alvo nenhum, o servidor já chegou lá por outro caminho.
    const outdated = await q.many<{ status: "superseded" | "nothing_to_do" }>(
      `update update_requests set status = case when $2::text is null then 'nothing_to_do' else 'superseded' end, finished_at = $1
        where status = 'requested' and target_version is distinct from $2 returning status`,
      [now, target],
    );
    for (const { status } of outdated) notices.push({ body: FINISHED[status]("") });
    const accepted = await q.exec("update update_requests set status = 'running', accepted_at = $1 where status = 'requested'", [now]);
    if (accepted > 0) notices.push({ body: STARTED });
    return { update: accepted > 0, whatsapp: wanted, notices };
  });
  // O pedido já foi aceito: um aviso que não entrou não pode custar a resposta ao agente.
  await leaveNotices(deps, outcome.notices).catch((error: unknown) => {
    process.stderr.write(`[panel] could not leave the update notice: ${error instanceof Error ? error.message : String(error)}\n`);
  });
  return { update: outcome.update, whatsapp: outcome.whatsapp };
}
