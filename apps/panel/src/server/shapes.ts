import { toE164, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { ApiError } from "./context";
import { listEngines } from "./pieces";
import { isTrunkHost } from "./trunk-host";

/** Telefone digitado livremente; sai em E.164 ou reprova a validação. */
export const phone = z.string().transform((value, ctx) => {
  const e164 = toE164(value);
  if (e164 === null) {
    ctx.addIssue({ code: "custom", message: `"${value}" is not a valid phone number` });
    return z.NEVER;
  }
  return e164;
});
/** Vazio ou nulo apaga o telefone. */
export const optionalPhone = z.union([z.null(), z.literal("").transform(() => null), phone]);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === "" ? null : value));

export const AGENT_COLUMNS = `id, name, role_label as "roleLabel", instructions, greeting, engine, voice_id as "voiceId", language, tools,
  enabled, max_call_seconds as "maxCallSeconds", cost_ceiling_cents as "costCeilingCents", transfer_to_e164 as "transferTo",
  follow_up_owner_user_id as "followUpOwnerUserId", created_at as "createdAt", updated_at as "updatedAt"`;

const agentFields = z.object({
  name: z.string().trim().min(1).max(80),
  roleLabel: optionalText(80),
  instructions: z.string().max(20000),
  greeting: optionalText(1000),
  engine: z.string().refine(async (id) => (await listEngines()).some((engine) => engine.id === id), "unknown voice engine"),
  voiceId: optionalText(80),
  language: z.string().min(2).max(20),
  tools: z.array(z.string().min(1)).max(50),
  enabled: z.boolean(),
  maxCallSeconds: z.number().int().min(30).max(7200),
  costCeilingCents: z.number().int().min(0).max(100000),
  transferTo: optionalPhone,
  // A pessoa que recebe as pendências que o agente abre; nula é a equipe. Pessoa de outra
  // organização cai na chave estrangeira composta, e vira 404.
  followUpOwnerUserId: z.uuid().nullable(),
});
export type AgentValues = z.output<typeof agentFields>;
export const agentPatch = agentFields.partial();
export const agentCreate = agentPatch.required({ name: true, engine: true });

export const AGENT_DEFAULTS: Omit<AgentValues, "name" | "engine"> = {
  roleLabel: null,
  instructions: "",
  greeting: null,
  voiceId: null,
  language: "pt-BR",
  tools: [],
  enabled: true,
  maxCallSeconds: 600,
  costCeilingCents: 500,
  transferTo: null,
  followUpOwnerUserId: null,
};

export const TRUNK_COLUMNS = `id, name, host, username, auth_mode as "authMode", caller_id_e164 as "callerId", status,
  last_check_at as "lastCheckAt", last_error as "lastError", json_build_object('configured', secret_enc is not null) as secret`;

// Host, usuário e senha acabam dentro da configuração gerada do Asterisk: nada de quebra de linha
// nem de caractere que abra seção ou comentário ali.
const trunkFields = z.object({
  name: z.string().trim().min(1).max(80),
  host: z.string().trim().refine(isTrunkHost, "must be a host name or IP (optionally with :port), an IPv6 address or a CIDR block"),
  username: z.union([z.null(), z.literal("").transform(() => null), z.string().regex(/^[^\s;[\]]{1,80}$/, "cannot contain spaces, ';' or brackets")]),
  password: z.string().regex(/^[^\r\n]{1,200}$/, "cannot be empty or contain line breaks"),
  authMode: z.enum(["register", "ip"]),
  callerId: optionalPhone,
});
export const trunkPatch = trunkFields.partial();
export const trunkCreate = trunkPatch.required({ name: true, host: true, authMode: true });

export const CALL_COLUMNS = `c.id, c.agent_id as "agentId", a.name as "agentName", c.direction, c.from_e164 as "from", c.to_e164 as "to",
  c.status, c.end_reason as "endReason", c.engine, c.started_at as "startedAt", c.answered_at as "answeredAt", c.ended_at as "endedAt",
  c.cost_cents as "costCents", c.summary`;
export const CALL_STATUSES = ["ringing", "in_progress", "transferred", "completed", "failed", "refused"] as const;

export async function requireAgent(q: OrgQuery, agentId: string): Promise<void> {
  if (!(await q.one("select 1 from agents where id = $1", [agentId]))) throw new ApiError(404, "not_found", "Agent not found.");
}

/** Mesma regra do comando que cria o primeiro dono (`create-owner`): no mínimo 10 caracteres. */
export const newPassword = z.string().min(10).max(1000);
export const roleName = z.enum(["owner", "admin", "operator"]);
