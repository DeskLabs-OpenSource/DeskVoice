import type { ApprovalOutcome, Clock, OrgQuery } from "@deskvoice/core";
import type { ZodType } from "zod";

export interface ToolContext {
  organizationId: string;
  callId: string;
  agentId: string;
  q: OrgQuery;
  clock: Clock;
  telephony: {
    /** `false`: o canal desta chamada não tem para onde transferir (a ligação pelo WhatsApp). */
    canTransfer: boolean;
    transfer(toE164: string): Promise<void>;
    /** Aperta teclas no menu do outro lado. A ligação pelo WhatsApp não declara: lá a ferramenta recusa. A chamada simulada declara e só registra as teclas. */
    sendDtmf?(digits: string): Promise<void>;
    /** Com `farewell`, o agente fala a despedida e só então a ligação cai. */
    hangup(farewell?: string): Promise<void>;
    /**
     * Para de gravar a ligação, mantendo gravado tudo o que já foi dito. Diz o que de fato
     * aconteceu: sem gravação em curso (desligada, sem espaço, falhou), nada é parado nem registrado.
     */
    pauseRecording(reason: string): Promise<RecordingStop>;
  };
  /** Faz o agente dizer algo enquanto a ferramenta trabalha ("um instante, estou conferindo"). */
  say(text: string): void;
  waitForApproval(approvalId: string, timeoutMs: number): Promise<ApprovalOutcome>;
}

/**
 * O que um pedido de parar a gravação produziu: `stopped` parou agora e registrou o pedido;
 * `already_stopped` já tinha parado antes nesta ligação; `not_recording` não havia o que parar.
 */
export type RecordingStop = "stopped" | "already_stopped" | "not_recording";

export interface ToolResult {
  ok: boolean;
  /** Texto devolvido ao modelo: o que aconteceu e o que ele deve dizer a quem está na linha. */
  message: string;
  data?: unknown;
  /**
   * `true` com `ok: false`: a ferramenta recusou antes de fazer qualquer efeito (nada foi escrito,
   * enviado nem chamado), e a vaga do teto por ligação volta. Sem ele, a vaga fica gasta, porque o
   * efeito pode ter saído: o webhook que respondeu erro já recebeu o POST.
   */
  noEffect?: boolean;
}

export interface Tool<Input = unknown> {
  name: string;
  description: string;
  /** JSON Schema entregue ao motor de voz. */
  parameters: Record<string, unknown>;
  inputSchema: ZodType<Input>;
  /**
   * Os argumentos são texto sobre quem ligou (o título de uma pendência, uma nota). Com `true`,
   * `tool_called` não os grava: o texto mora só onde o prazo de guarda o alcança (registro 0014).
   */
  personalTextArgs?: boolean;
  /**
   * `false`: falta a peça de que a ferramenta depende (a agenda sem cliente). A sessão não a oferece
   * ao motor, mesmo marcada no agente, e o agente de exemplo não nasce com ela. Omitido vale `true`.
   */
  available?: boolean;
  /**
   * `true`: nenhum agente nasce com ela, nem o de exemplo; só a tem quem a marcar na tela do agente.
   * Para a ferramenta que guarda dado novo sobre quem liga (a nota), que pede uma escolha (registro 0020, 1A).
   */
  offByDefault?: boolean;
  run(input: Input, ctx: ToolContext): Promise<ToolResult>;
}
