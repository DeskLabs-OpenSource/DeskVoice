// As peças de montar a sessão do motor para um agente: as ferramentas que ele recebe e a
// configuração da sessão (seção 5.4 de docs/specs/2026-11-21-testes-do-agente.md, fatia 7b). A
// ligação (`call-session.ts`) e o teste do agente (`agent-test.ts`) montam pelo mesmo arquivo, e
// uma cerca confere que, para o mesmo agente, as duas só diferem em `mode`.
//
// Este arquivo não roda ferramenta e não importa quem roda (`runTool`): o executor do teste o
// importa, e a cerca `fences/agent-test-runs-no-tool.test.ts` confere o executor.
import { TRANSFER_TO_AGENT, toSpec, type HandoffTarget, type Tool } from "@deskvoice/tools";
import type { VoiceSessionConfig } from "@deskvoice/voice-engine";
import type { Logger } from "./log";

/** A chave do motor na tabela `settings` da organização. */
export const engineKeySetting = (engineId: string): string => `engine.${engineId}.api_key`;

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
  log: Logger;
}

/** As ferramentas que o motor recebe para o agente. */
export function enabledToolsFor({ installed, names, targets, canTransfer, returned, log }: EnabledToolsInput): Map<string, Tool> {
  const enabled = new Map<string, Tool>();
  for (const name of names) {
    const tool = installed.get(name);
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
