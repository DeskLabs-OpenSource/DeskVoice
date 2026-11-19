/**
 * A escolha de quem lê a ligação na tela do agente (R4, fatia 5), como o rascunho a guarda. `organization`
 * é a coluna nula (segue `calls.analysis_brain`); `engine` e `brain` são as formas de
 * `AgentAnalysisBrain`; `invalid` é o valor gravado fora da forma, que a tela mostra e nunca regrava.
 */
export type AnalysisDraft = { kind: "organization" } | { kind: "engine" } | { kind: "brain"; brain: string; model: string } | { kind: "invalid" };

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** O `analysisBrain` que a API devolve, no rascunho. Ausente ou nulo é a organização. */
export function toAnalysisDraft(value: unknown): AnalysisDraft {
  if (value === null || value === undefined) return { kind: "organization" };
  if (typeof value !== "object" || Array.isArray(value)) return { kind: "invalid" };
  const choice = value as Record<string, unknown>;
  const keys = Object.keys(choice).sort().join(",");
  if (choice.kind === "engine" && keys === "kind") return { kind: "engine" };
  if (choice.kind === "brain" && keys === "brain,kind,model" && isText(choice.brain) && isText(choice.model)) return { kind: "brain", brain: choice.brain, model: choice.model };
  return { kind: "invalid" };
}

const sameChoice = (a: AnalysisDraft, b: AnalysisDraft): boolean =>
  a.kind === b.kind && (a.kind !== "brain" || (b.kind === "brain" && a.brain === b.brain && a.model === b.model));

/**
 * O que o salvar manda de quem lê a ligação: nada quando a escolha não mudou (salvar outro campo não
 * regrava a coluna, nem refaz a conferência de um cérebro que perdeu a chave depois) e nada quando ela
 * está fora da forma. `acceptUnmeasured` vai só com o cérebro escolhido agora cujo aviso de modelo sem
 * preço está na tela.
 */
export function analysisPatch(
  draft: AnalysisDraft,
  saved: AnalysisDraft,
  acceptUnmeasured: boolean,
): { analysisBrain: { kind: "engine" } | { kind: "brain"; brain: string; model: string } | null; acceptUnmeasured?: true } | Record<string, never> {
  if (draft.kind === "invalid" || sameChoice(draft, saved)) return {};
  if (draft.kind === "organization") return { analysisBrain: null };
  if (draft.kind === "engine") return { analysisBrain: { kind: "engine" } };
  return { analysisBrain: { kind: "brain", brain: draft.brain, model: draft.model }, ...(acceptUnmeasured && { acceptUnmeasured: true as const }) };
}
