import { agentAnalysisBrain, type AgentAnalysisBrain, callerMessageBlock, checkVocabulary, DROP_FOLLOW_UP_MESSAGE_MAX, ORGANIZATION_SUSPENDED, organizationSuspended, toE164, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { checkAnalysisBrain } from "./brains";
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
/** Nomes e termos que o agente deve esperar ouvir; a regra é a de `checkVocabulary`, a mesma da tela. */
const vocabulary = z.array(z.string()).transform((terms, ctx) => {
  const checked = checkVocabulary(terms);
  if (!checked.ok) {
    ctx.addIssue({ code: "custom", message: checked.reason });
    return z.NEVER;
  }
  return checked.terms;
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
  enabled, max_call_seconds as "maxCallSeconds", cost_ceiling_cents as "costCeilingCents", transfer_to_e164 as "transferTo", transfer_returns_to_agent as "transferReturnsToAgent",
  follow_up_owner_user_id as "followUpOwnerUserId", vocabulary, listening_environment as "listeningEnvironment",
  agent_handoff_targets as "agentHandoffTargets", drop_follow_up as "dropFollowUp",
  drop_follow_up_message as "dropFollowUpMessage", analyst_id as "analystId", analysis_brain as "analysisBrain", created_at as "createdAt", updated_at as "updatedAt"`;

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
  // Ninguém atendeu a transferência: a ligação volta para o agente (Vapi · fatia 5a). Ligada de fábrica.
  transferReturnsToAgent: z.boolean(),
  // A pessoa que recebe as pendências que o agente abre; nula é a equipe. A rota confere que ela
  // está ativa (`requireActiveOwner`); a de outra organização nem é vista.
  followUpOwnerUserId: z.uuid().nullable(),
  vocabulary,
  // Ambiente de quem liga: `noisy` ajusta a detecção de fala do provedor para ruído de fundo.
  listeningEnvironment: z.enum(["normal", "noisy"]),
  // O que acontece quando a ligação cai (desenho do follow-up da ligação que caiu, seção 3.2). O
  // `whatsapp` e o `call_back` passam por `requireDropFollowUpMode`, que confere o pré-requisito.
  dropFollowUp: z.enum(["off", "task", "whatsapp", "call_back"]),
  // O texto do WhatsApp para quem ligou: fixo, escrito pelo operador, sem variável. Vazio vale o padrão.
  dropFollowUpMessage: optionalText(DROP_FOLLOW_UP_MESSAGE_MAX),
  // Para quem o agente pode passar a ligação (`transfer_to_agent`). A rota confere que cada um é
  // outro agente desta organização (`requireHandoffTargets`); vazia, a ferramenta não aparece.
  agentHandoffTargets: z
    .array(z.uuid())
    .max(50)
    .transform((ids) => [...new Set(ids)]),
  // O analista ao vivo do agente (desenho dos analistas, seção 3.1); nulo é nenhum. A rota confere
  // que ele é desta organização (`requireAnalyst`).
  analystId: z.uuid().nullable(),
  // Quem lê a ligação deste agente (R4, fatia 5); nulo segue a organização (`calls.analysis_brain`).
  // A rota confere o cérebro e o modelo (`requireAnalysisBrain`) com a mesma regra da organização.
  analysisBrain: agentAnalysisBrain.nullable(),
});
export type AgentValues = z.output<typeof agentFields>;
// `acceptUnmeasured` vale só para este pedido, como em `calls.analysis_brain`: não é gravado.
export const agentPatch = agentFields.partial().extend({ acceptUnmeasured: z.boolean().optional() });
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
  transferReturnsToAgent: true,
  followUpOwnerUserId: null,
  vocabulary: [],
  listeningEnvironment: "normal",
  agentHandoffTargets: [],
  dropFollowUp: "off",
  dropFollowUpMessage: null,
  analystId: null,
  analysisBrain: null,
};

export const TRUNK_COLUMNS = `id, name, host, username, auth_mode as "authMode", caller_id_e164 as "callerId",
  match_extra as "matchExtra", outbound_host as "outboundHost", status,
  inbound_allowed as "inboundAllowed", inbound_resolved_at as "inboundResolvedAt", inbound_filter as "inboundFilter",
  last_check_at as "lastCheckAt", last_error as "lastError", json_build_object('configured', secret_enc is not null) as secret`;

// Host, usuário e senha acabam dentro da configuração gerada do Asterisk: nada de quebra de linha
// nem de caractere que abra seção ou comentário ali.
const trunkHost = z.string().trim().refine(isTrunkHost, "must be a host name or IP (optionally with :port), an IPv6 address or a CIDR block");
const trunkFields = z.object({
  name: z.string().trim().min(1).max(80),
  host: trunkHost,
  username: z.union([z.null(), z.literal("").transform(() => null), z.string().regex(/^[^\s;[\]]{1,80}$/, "cannot contain spaces, ';' or brackets")]),
  password: z.string().regex(/^[^\r\n]{1,200}$/, "cannot be empty or contain line breaks"),
  authMode: z.enum(["register", "ip"]),
  callerId: optionalPhone,
  // O mesmo provedor entrega a ligação por vários blocos (um por região). Na linha por IP todos
  // entram no `identify`; na linha por registro só liberam a entrada. Sem lista, vale o `host`.
  matchExtra: z.array(trunkHost).max(16, "at most 16 extra addresses").optional(),
  // Nome ou IP do destino das ligações de saída; vazio vale o `host`.
  outboundHost: z.union([z.null(), z.literal("").transform(() => null), trunkHost]).optional(),
});
// `confirmOverlap`: a pessoa leu o aviso de que a faixa cruza a de outra organização (R8, fatia 10)
// e salva mesmo assim. Não é coluna: só libera a gravação.
export const trunkPatch = trunkFields.extend({ confirmOverlap: z.boolean().optional() }).partial();
export const trunkCreate = trunkPatch.required({ name: true, host: true, authMode: true });
// Liga ou desliga o filtro de entrada da linha por registro (R14, contrato 11). Fica fora de
// `trunkPatch`: salvar o formulário da linha não mexe no filtro.
export const trunkInboundFilter = z.object({ enabled: z.boolean() });

export const CALL_COLUMNS = `c.id, c.agent_id as "agentId", a.name as "agentName", c.direction, c.channel, c.from_e164 as "from", c.to_e164 as "to",
  c.status, c.end_reason as "endReason", c.engine, c.started_at as "startedAt", c.answered_at as "answeredAt", c.ended_at as "endedAt",
  c.cost_cents as "costCents", c.summary,
  c.outcome, c.outcome_confidence as "outcomeConfidence", c.outcome_evidence as "outcomeEvidence",
  c.analysis_score as "analysisScore", c.voicemail`;
export const CALL_STATUSES = ["ringing", "in_progress", "transferred", "completed", "failed", "refused"] as const;

/** O dono das pendências de um agente é uma pessoa ativa da equipe (nunca o vínculo de suporte); outra coisa é recusada com motivo. */
export async function requireActiveOwner(q: OrgQuery, userId: string | null | undefined): Promise<void> {
  if (userId === null || userId === undefined) return;
  if (!(await q.one("select 1 from users where id = $1 and kind = 'member' and disabled_at is null for share", [userId]))) {
    throw new ApiError(400, "owner_unavailable", "The follow-up owner must be an active person of this team.");
  }
}

/**
 * O modo `whatsapp` de "Quando a ligação cai" só pode ser escolhido com conector de WhatsApp e com
 * `whatsapp.trust_caller_id` ligado (seção 3.5 do desenho): sem eles, a mensagem nunca sairia. O modo
 * `call_back` só pode ser escolhido com as ligações de saída ligadas (`outbound_policy.enabled`, seção
 * 3.6): a tela desabilitada não é a única barreira. A revisão confere de novo na hora de agir, porque
 * o ajuste pode ser desligado depois, e a religação passa pela política inteira na hora de discar.
 */
export async function requireDropFollowUpMode(q: OrgQuery, mode: string | undefined): Promise<void> {
  if (mode === "call_back") {
    // Trava a linha da política até o fim da escrita: desligada no meio, a escolha não passa.
    const policy = await q.one<{ enabled: boolean }>("select enabled from outbound_policy for share");
    if (policy?.enabled !== true)
      throw new ApiError(400, "drop_follow_up_outbound_disabled", "Turn outbound calls on in Outbound calls, stating the purpose and the legal basis, before choosing to call the caller back.");
    return;
  }
  if (mode !== "whatsapp") return;
  const block = await callerMessageBlock(q);
  if (block === "whatsapp_not_connected") throw new ApiError(400, "drop_follow_up_whatsapp_not_connected", "Connect WhatsApp in Settings → WhatsApp before choosing to message the caller.");
  if (block === "caller_id_not_trusted")
    throw new ApiError(400, "drop_follow_up_caller_id_not_trusted", "Turn on trusting the caller's number in Settings → WhatsApp before choosing to message the caller.");
}

/**
 * Os destinos de passagem são outros agentes desta organização. O de outra organização nem é visto
 * (`withOrg`), e volta o mesmo erro do que não existe; o próprio agente também é recusado. Os
 * destinos ficam travados até o fim da escrita: apagados no meio, o banco recusaria com
 * `check_violation`, e a pessoa leria um erro cru.
 */
export async function requireHandoffTargets(q: OrgQuery, selfId: string | null, targets: readonly string[] | undefined): Promise<void> {
  if (!targets || targets.length === 0) return;
  if (selfId !== null && targets.includes(selfId)) {
    throw new ApiError(400, "handoff_target_invalid", "An agent cannot hand the call off to itself.");
  }
  const found = await q.many<{ id: string }>("select id from agents where id = any($1::uuid[]) for share", [targets]);
  if (found.length !== targets.length) {
    throw new ApiError(400, "handoff_target_invalid", "Every handoff target must be another agent of this organization.");
  }
}

/**
 * O analista do agente é um desta organização. O de outra organização nem é visto (`withOrg`), e volta
 * o mesmo erro do que não existe. Fica travado até o fim da escrita: apagado no meio, o banco recusaria
 * a chave estrangeira, e a pessoa leria um erro cru.
 */
export async function requireAnalyst(q: OrgQuery, analystId: string | null | undefined): Promise<void> {
  if (analystId === null || analystId === undefined) return;
  if (!(await q.one("select 1 from analysts where id = $1 for share", [analystId]))) {
    throw new ApiError(400, "analyst_invalid", "The analyst must be one of this organization.");
  }
}

/**
 * O cérebro que o agente escolheu para ler a ligação passa pela mesma conferência da escolha da
 * organização (`checkAnalysisBrain`). Nulo (segue a organização) e o motor do agente não pedem nada.
 */
export async function requireAnalysisBrain(q: OrgQuery, choice: AgentAnalysisBrain | null | undefined, acceptUnmeasured: boolean | undefined): Promise<void> {
  if (choice?.kind !== "brain") return;
  await checkAnalysisBrain(q, { brain: choice.brain, model: choice.model, acceptUnmeasured });
}

/**
 * A organização da sessão não está suspensa: a suspensa não atende nem pelo navegador nem pela
 * simulada (seção 3.3 do desenho do R8). Quem mostra a tela de organização suspensa é a fatia 4b.
 */
export async function requireActiveOrganization(q: OrgQuery): Promise<void> {
  if (await organizationSuspended(q)) throw new ApiError(409, ORGANIZATION_SUSPENDED, "This organization is suspended: it does not take calls.");
}

export async function requireAgent(q: OrgQuery, agentId: string): Promise<void> {
  if (!(await q.one("select 1 from agents where id = $1", [agentId]))) throw new ApiError(404, "not_found", "Agent not found.");
}

/** Mesma regra do comando que cria o primeiro dono (`create-owner`): no mínimo 10 caracteres. */
export const newPassword = z.string().min(10).max(1000);
export const roleName = z.enum(["owner", "admin", "operator"]);
