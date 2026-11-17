import type { OrgQuery } from "@deskvoice/core";
import type { HandoffTarget } from "./types";

/**
 * Quantas vezes uma ligação passa de um agente para outro. Na quarta, `transfer_to_agent` recusa e
 * indica `transfer_to_human`. Constante, sem configuração: ninguém pediu outro valor (desenho de
 * 13/11, seção 4.2).
 */
export const MAX_AGENT_HANDOFFS_PER_CALL = 3;

/** O nome do agente atual e os destinos para quem ele pode passar a ligação. */
export interface HandoffTargets {
  self: { id: string; name: string } | null;
  targets: HandoffTarget[];
}

/**
 * Lê, dentro da organização de `q`, para quem o agente pode passar a ligação. Só entram os destinos que
 * existem, que são da mesma organização e que não são o próprio agente: o gatilho do banco já recusa
 * na escrita um agente de outra organização, e esta leitura confere de novo, pelo `withOrg` e pelo
 * nome da organização, para que nem um banco mexido à mão ponha um agente de fora na ligação.
 * A ordem é a do nome, para as instruções saírem iguais em toda ligação.
 */
export async function handoffTargetsOf(q: OrgQuery, agentId: string): Promise<HandoffTargets> {
  const self = await q.one<{ id: string; name: string; agent_handoff_targets: string[] }>("select id, name, agent_handoff_targets from agents where id = $1", [agentId]);
  if (!self) return { self: null, targets: [] };
  if (self.agent_handoff_targets.length === 0) return { self: { id: self.id, name: self.name }, targets: [] };
  const rows = await q.many<{ id: string; name: string; role_label: string | null }>(
    "select id, name, role_label from agents where id = any($1::uuid[]) and organization_id = $2 and id <> $3 order by name, id",
    [self.agent_handoff_targets, q.organizationId, agentId],
  );
  return { self: { id: self.id, name: self.name }, targets: rows.map((row) => ({ id: row.id, name: row.name, roleLabel: row.role_label })) };
}

/** O nome da ferramenta de passagem, que a sessão oferece sozinha quando o agente tem destino. */
export const TRANSFER_TO_AGENT = "transfer_to_agent";
