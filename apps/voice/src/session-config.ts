// As peças de montar a sessão do motor para um agente: as ferramentas que ele recebe e a
// configuração da sessão (seção 5.4 de docs/specs/2026-11-21-testes-do-agente.md, fatia 7b). A
// ligação (`call-session.ts`) e o teste do agente (`agent-test.ts`) montam pelo mesmo arquivo, e
// uma cerca confere que, para o mesmo agente, as duas só diferem em `mode`.
//
// Este arquivo não roda ferramenta e não importa quem roda (`runTool`): o executor do teste o
// importa, e a cerca `fences/agent-test-runs-no-tool.test.ts` confere o executor.
import { rememberedBlock, type RememberedItem } from "@deskvoice/core";
import { mcpToolFingerprint, mcpTools, TRANSFER_TO_AGENT, toSpec, type HandoffTarget, type RegisteredMcpServer, type Tool } from "@deskvoice/tools";
import { SIMULATED_PREFIX, type VoiceSessionConfig } from "@deskvoice/voice-engine";
import type { Logger } from "./log";

/** A chave do motor na tabela `settings` da organização. */
export const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;

/** O aviso de gravação que o operador escreveu, na tabela `settings` da organização. */
export const RECORDING_NOTICE_SETTING = "recording_notice.text";
/** O aviso que vale quando o operador não escreveu o dele. Toda chamada começa por um aviso. */
export const DEFAULT_RECORDING_NOTICE = "Esta ligação é atendida por uma assistente virtual e a conversa fica registrada.";

/** O aviso que vale, a partir do valor gravado: sem texto, ou com texto em branco, vale o padrão. */
export const recordingNoticeOf = (stored: unknown): string => (typeof stored === "string" && stored.trim() !== "" ? stored.trim() : DEFAULT_RECORDING_NOTICE);

/**
 * A abertura da ligação recebida: o aviso antes de tudo, e depois a saudação do agente. Os motores
 * falam a abertura ao conectar. O teste do agente abre do mesmo jeito.
 */
export const inboundOpening = (notice: string, greeting: string | null | undefined): string => [notice, greeting?.trim()].filter(Boolean).join(" ");

/** O que entra nas instruções do agente que recebe a ligação: quem passou, o motivo e o resumo. */
export interface HandoffNote {
  fromName: string;
  reason: string;
  summary: string;
}

// Nome e papel do agente vêm da configuração, e não de quem ligou; ainda assim ficam numa linha só,
// para nenhum nome mal digitado abrir um parágrafo nas instruções.
export const oneLine = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();

/**
 * O motivo e o resumo da passagem como itens do bloco lembrado. A mesma lista vai para
 * `composeInstructions` e para o corte da memória na passagem: o que é medido é, byte a byte, o que vai.
 */
export function handoffItems(handoff: Pick<HandoffNote, "reason" | "summary">): RememberedItem[] {
  return [
    { label: "motivo", text: handoff.reason },
    { label: "resumo", text: handoff.summary },
  ];
}

/**
 * As instruções que a sessão entrega ao motor. Sem destino e sem passagem, são as do agente, byte a
 * byte. Com destino, ganham uma linha por agente para quem ele pode passar a ligação, com nome e papel.
 * Com passagem, ganham quem passou e, no bloco delimitado e escapado (`rememberedBlock`, registro
 * 0020), o motivo e o resumo: texto do modelo a partir da fala de quem ligou, que é dado e nunca
 * instrução. Nada do resumo muda a configuração: os destinos e as ferramentas vêm só do banco.
 *
 * Com a memória do número (`memory`, fatia 6: as notas e os títulos de pendência que
 * `loadCallerMemory` montou), os itens entram no mesmo bloco, depois do motivo e do resumo quando há
 * passagem: as instruções nunca têm mais de um bloco. Sem item, nada muda.
 *
 * O roteiro do motor simulado (`simulated:` seguido de JSON) passa intacto: ninguém o lê como
 * instrução, e qualquer texto colado nele quebraria o `JSON.parse` do motor. O teste lê as instruções
 * montadas com um motor que as guarda.
 */
export function composeInstructions(base: string, targets: readonly HandoffTarget[], handoff?: HandoffNote, memory: readonly RememberedItem[] = []): string {
  if (base.startsWith(SIMULATED_PREFIX)) return base;
  const parts = [base];
  if (targets.length > 0) {
    parts.push(
      [
        "Agentes para quem você pode passar a ligação com transfer_to_agent, pelo nome exato:",
        ...targets.map((target) => `- ${oneLine(target.name)}${target.roleLabel?.trim() ? ` (${oneLine(target.roleLabel)})` : ""}`),
      ].join("\n"),
    );
  }
  if (handoff) {
    parts.push(
      [
        `Esta ligação veio do agente ${oneLine(handoff.fromName)}, que já saiu da linha. Quem ligou já ouviu o aviso de gravação e acabou de ouvir você dizer que continua o atendimento. Continue a partir do motivo e do resumo da passagem, sem pedir de novo o que já foi dito.`,
        rememberedBlock([...handoffItems(handoff), ...memory]),
      ].join("\n"),
    );
  } else if (memory.length > 0) {
    parts.push(rememberedBlock(memory));
  }
  return parts.join("\n\n");
}

/** O que a configuração da sessão lê do agente. */
export interface SessionAgent {
  voice_id: string | null;
  language: string;
  vocabulary: string[];
  listening_environment: "normal" | "noisy";
}

export interface EnabledToolsInput {
  /** As ferramentas instaladas. */
  installed: Map<string, Tool>;
  /** As marcadas no agente (`agents.tools`). */
  names: readonly string[];
  /** Os agentes para quem ele pode passar a ligação, já conferidos (`handoffTargetsOf`). */
  targets: readonly HandoffTarget[];
  /** O canal transfere para uma pessoa. A ligação pelo WhatsApp não transfere. */
  canTransfer: boolean;
  /** A ligação já voltou de uma transferência sem atendimento. */
  returned: boolean;
  /**
   * Os servidores MCP da organização da ligação (`loadMcpServers`, lido pelo `OrgQuery` dela).
   * Ausente, nenhum: a sessão recebe o mesmo de antes.
   */
  mcpServers?: readonly RegisteredMcpServer[];
  log: Logger;
}

/**
 * As ferramentas MCP que podem ir ao motor, pelo nome `<servidor>__<ferramenta>`: só as do retrato
 * marcadas pelo operador (`allowed`), dentro do subconjunto (`supported`) e cujo retrato ainda é o
 * que foi marcado. Se o nome, a descrição ou o esquema gravados já não dão a impressão digital
 * gravada, o retrato mudou depois da marca, e a ferramenta fica fora até o operador marcar de novo.
 */
function markedMcpTools(servers: readonly RegisteredMcpServer[], log: Logger): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  for (const server of servers) {
    const unchanged = server.tools.filter((snapshot) => {
      if (!snapshot.allowed || !snapshot.supported) return false;
      if (mcpToolFingerprint(snapshot) === snapshot.fingerprint) return true;
      log("error", "MCP tool changed since the operator marked it; ignoring it", { server: server.slug, tool: snapshot.name });
      return false;
    });
    for (const tool of mcpTools({ ...server, tools: unchanged })) tools.set(tool.name, tool);
  }
  return tools;
}

/** As ferramentas que o motor recebe para o agente. */
export function enabledToolsFor({ installed, names, targets, canTransfer, returned, mcpServers = [], log }: EnabledToolsInput): Map<string, Tool> {
  const enabled = new Map<string, Tool>();
  // As MCP entram como as da pasta: o nome precisa estar marcado no agente (`agents.tools`) e no
  // servidor. A da pasta vem primeiro; a cerca do `__` garante que nenhuma da pasta tem esse nome.
  const mcp = markedMcpTools(mcpServers, log);
  for (const name of names) {
    const tool = installed.get(name) ?? mcp.get(name);
    // Sem transferência no canal (ligação pelo WhatsApp), o motor nem a vê: a descrição manda
    // anunciar a transferência antes de chamar, e quem ligou ouviria "vou transferir" e o recuo.
    // Depois de uma transferência que voltou, também não: o agente não transfere de novo, em laço.
    if (name === "transfer_to_human" && (!canTransfer || returned)) continue;
    // Ferramenta sem a peça de que depende (a agenda sem cliente) também some: oferecida, o motor a
    // chamaria em toda ligação de agendamento só para ouvir que ela não está ligada.
    if (tool?.available === false) continue;
    // A passagem não se marca: o que a liga é a lista de destinos, abaixo.
    if (tool?.offeredBySession === true) continue;
    if (tool) enabled.set(name, tool);
    else log("error", "agent enables a tool that is not installed; ignoring it", { tool: name });
  }
  // Sem destino que exista, a ferramenta não aparece, e o motor recebe o mesmo de antes.
  const handoffTool = installed.get(TRANSFER_TO_AGENT);
  if (targets.length > 0 && handoffTool) enabled.set(TRANSFER_TO_AGENT, handoffTool);
  return enabled;
}

/**
 * A configuração da sessão do motor. `mode` ausente é a ligação de sempre (áudio); o teste do agente
 * pede `text`, e é a única diferença.
 */
export function sessionConfig(
  agent: SessionAgent,
  instructions: string,
  greeting: string | undefined,
  enabled: Map<string, Tool>,
  mode?: VoiceSessionConfig["mode"],
): VoiceSessionConfig {
  return {
    instructions,
    greeting,
    voiceId: agent.voice_id ?? undefined,
    language: agent.language,
    tools: [...enabled.values()].map(toSpec),
    // Dica de reconhecimento; vazia, o motor envia ao provedor o mesmo de antes.
    vocabulary: agent.vocabulary,
    // `normal` envia ao provedor o mesmo de antes; `noisy` ajusta a detecção de fala.
    listeningEnvironment: agent.listening_environment,
    // Só o teste pede: a ligação não leva o campo, e a configuração dela fica a de antes.
    ...(mode !== undefined && { mode }),
  };
}
