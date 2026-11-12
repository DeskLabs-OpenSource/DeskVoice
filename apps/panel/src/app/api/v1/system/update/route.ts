import { z } from "zod";
import { ApiError, CONFIG_ROLES, handle, notFound } from "../../../../../server/context";
import type { Published } from "../../../../../server/releases";
import { loginLimiter } from "../../../../../server/rate-limit";
import { compareVersions, isPublishedVersion, publishedReleases } from "../../../../../server/releases";
import { AGENT_SILENT_MINUTES, REQUEST_COLUMNS, expireStaleUpdates } from "../../../../../server/update";

/**
 * O que a tela de versão mostra. A versão em execução vem do processo (`APP_VERSION`), nunca do
 * banco; a mais recente publicada é consultada fora da transação, depois dela.
 */
export const GET = handle(
  {
    after: async (state: { running: { version: string }; agent: { targetVersion: string | null } | null }, { deps }) => {
      const published = await publishedReleases(deps);
      // O alvo é o que o SERVIDOR executaria (anunciado pelo agente), não o topo da lista pública.
      // As notas são as das versões até ele; sem a página dele, não há o que confirmar.
      const target = state.agent?.targetVersion ?? null;
      const releases = published.ok && target ? published.newer.filter((release) => compareVersions(release.version, target) <= 0) : [];
      // A lista pública e o agente não andam juntos: o agente só consulta as tags a cada 10 minutos.
      // `unseen` = a mais recente publicada é mais nova que a instalada e que o que o agente ofereceu.
      const latest = published.ok ? published.latest : null;
      const unseen = latest !== null && compareVersions(latest, state.running.version) > 0 && (target === null || compareVersions(latest, target) > 0);
      return { ...state, published, offer: { target, notesReady: releases.some((release) => release.version === target), releases, unseen } };
    },
  },
  async ({ q, deps, session }) => {
    await expireStaleUpdates(deps);
    // A saída do atualizador e a falha do agente citam caminhos e peças do servidor: só quem
    // administra a instalação lê. Operador vê o estado, sem o detalhe.
    const administers = CONFIG_ROLES.includes(session.role);
    const agent = await q.one<{ lastSeenAt: Date; version: string; targetVersion: string | null; lastFailureAt: Date | null; lastFailureDetail: string | null }>(
      `select last_seen_at as "lastSeenAt", announced_version as version, target_version as "targetVersion", last_failure_at as "lastFailureAt", last_failure_detail as "lastFailureDetail" from update_agent_status`,
    );
    const request = await q.one<{ detail: string | null }>(`select ${REQUEST_COLUMNS} from update_requests order by requested_at desc limit 1`);
    return {
      running: { version: deps.appVersion, updatable: isPublishedVersion(deps.appVersion) },
      agent: agent && { ...agent, lastFailureDetail: administers ? agent.lastFailureDetail : null, responding: deps.clock.now().getTime() - agent.lastSeenAt.getTime() < AGENT_SILENT_MINUTES * 60_000 },
      request: request && { ...request, detail: administers ? request.detail : null },
    };
  },
);

const body = z.object({ password: z.string().min(1).max(1000), target: z.string().min(1).max(40) });

/**
 * Pede a atualização. Só registra, e não fala com o servidor. `target` é a versão que a pessoa
 * viu na confirmação: tem de ser a que o agente anunciou por último e ter as notas publicadas.
 * Fica guardada só para comparar depois; para onde ir, quem decide é o servidor. Só dono e
 * administrador, com a senha conferida de novo, porque o pedido tira o sistema do ar.
 */
// A consulta às versões publicadas é de rede (até 5 s com o cache frio) e fica FORA da transação,
// como no GET: `before` a faz, e a transação só usa o que ela trouxe.
const consulted = new WeakMap<object, Published>();
export const POST = handle(
  {
    body,
    configure: true,
    before: async ({ body, deps }) => {
      consulted.set(body, await publishedReleases(deps));
    },
  },
  async ({ q, session, body, deps }) => {
    const now = deps.clock.now();
    // Mesmo limite do login: uma sessão roubada não vira tentativa ilimitada de adivinhar a senha.
    const key = `update:${session.userId}`;
    if (!loginLimiter.take(key, now)) throw new ApiError(429, "too_many_attempts", "Too many attempts. Wait a few minutes and try again.");
    const user = await q.one<{ passwordHash: string }>(`select password_hash as "passwordHash" from users where id = $1`, [session.userId]);
    if (!user) throw notFound();
    if (!(await deps.verifyPassword(body.password, user.passwordHash))) throw new ApiError(400, "wrong_password", "The password is incorrect.");
    loginLimiter.clear(key);

    if (!isPublishedVersion(deps.appVersion)) throw new ApiError(409, "update_unavailable", "This installation does not run a published version and cannot be updated from the panel.");
    const agent = await q.one<{ target: string | null }>("select target_version as target from update_agent_status");
    if (agent?.target !== body.target) throw new ApiError(409, "update_target_changed", "The server now points to a different version than the one confirmed. Reload and confirm again.");
    const published = consulted.get(body);
    if (!published?.ok || !published.newer.some((release) => release.version === body.target)) {
      throw new ApiError(409, "update_notes_missing", "The release notes of this version are not published yet.");
    }
    await expireStaleUpdates(deps);
    try {
      return await q.one(
        `insert into update_requests (organization_id, requested_by, from_version, target_version, requested_at) values ($1, $2, $3, $4, $5) returning ${REQUEST_COLUMNS}`,
        [session.organizationId, session.userId, deps.appVersion, body.target, now],
      );
    } catch (error) {
      // Quem garante "um pedido aberto por vez" é o índice único do banco, não uma consulta antes.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new ApiError(409, "update_in_progress", "There is already an update request in progress on this installation.");
      }
      throw error;
    }
  },
);
