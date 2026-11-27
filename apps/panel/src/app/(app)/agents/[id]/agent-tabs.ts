// As abas da tela do agente (desenho docs/specs/2026-11-26-construtor-de-agentes-abas.md, seção 4,
// fatia 1). A aba vive no endereço (`?aba=`), e as quatro do formulário são pedaços do mesmo `<form>`.
// A aba Ligações entra na fatia 5: até lá, ela não aparece.

export const AGENT_TABS = ["agente", "ferramentas", "depois", "testes", "avancado"] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

/** As abas que só existem com o agente salvo: elas leem dados que dependem do id. */
const SAVED_ONLY: readonly AgentTab[] = ["testes"];

/** As abas que fazem parte do formulário: nelas, o rodapé com o Salvar aparece. */
export const FORM_TABS: readonly AgentTab[] = ["agente", "ferramentas", "depois", "avancado"];

export const agentTabs = (isNew: boolean): readonly AgentTab[] => (isNew ? AGENT_TABS.filter((tab) => !SAVED_ONLY.includes(tab)) : AGENT_TABS);

/** A aba do endereço. Sem `aba`, com um valor desconhecido, ou com uma aba que o agente novo não tem, abre Agente. */
export const parseAgentTab = (value: string | null | undefined, isNew: boolean): AgentTab => agentTabs(isNew).find((tab) => tab === value) ?? "agente";

/** Em qual aba fica cada campo do rascunho (a tabela 4.1, fatia 1). */
export const DRAFT_TAB = {
  name: "agente",
  roleLabel: "agente",
  enabled: "agente",
  language: "agente",
  greeting: "agente",
  instructions: "agente",
  vocabulary: "agente",
  engine: "agente",
  voiceId: "agente",
  listeningEnvironment: "agente",
  // O Pipeline (fatia 6b) fica com o Motor, na aba Agente, até a fatia 2 separar Ouvido, Cérebro e Voz.
  pipelineOn: "agente",
  pieces: "agente",
  // "Cérebros deste agente" fica inteiro na aba Agente na fatia 1; quem lê a ligação muda de aba na fatia 2.
  analysis: "agente",
  tools: "ferramentas",
  transferTo: "ferramentas",
  transferReturns: "ferramentas",
  handoffTargets: "ferramentas",
  analystId: "ferramentas",
  followUpOwner: "depois",
  dropFollowUp: "depois",
  dropFollowUpMessage: "depois",
  maxMinutes: "avancado",
  costCeiling: "avancado",
  callerIdleGuard: "avancado",
} as const satisfies Record<string, AgentTab>;

/** As abas onde o rascunho difere do que está gravado, na ordem das abas. `tabOf` diz a aba de cada campo. */
export function changedTabs<D extends object>(draft: D, saved: D, tabOf: Record<keyof D, AgentTab>): AgentTab[] {
  const keys = Object.keys(tabOf) as (keyof D)[];
  const changed = new Set(keys.filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key])).map((key) => tabOf[key]));
  return AGENT_TABS.filter((tab) => changed.has(tab));
}

/** A aba fechada que esconde um campo: a do `tabpanel` dele. `null` quando o campo está à vista. */
export function hiddenTabOf(field: Element | null): AgentTab | null {
  const panel = field?.closest<HTMLElement>('[role="tabpanel"]');
  if (!panel?.hidden) return null;
  return AGENT_TABS.find((tab) => tab === panel.dataset.tab) ?? null;
}
