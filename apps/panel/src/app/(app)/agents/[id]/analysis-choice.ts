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

/**
 * Se o seletor de Modelo barra o salvar da página: só com o cérebro escolhido sem modelo. O modelo
 * gravado que saiu da lista do cérebro não barra: salvar outro campo grava esse campo e não regrava a
 * coluna (`analysisPatch` não manda nada), e o aviso do modelo que sumiu continua na tela.
 */
export function modelRequired(draft: AnalysisDraft): boolean {
  return draft.kind === "brain" && draft.model === "";
}

/** O que a lista de Cérebros diz de cada um: na escolha só valem os que têm chave aceita. */
export interface BrainOption {
  id: string;
  label: string;
  configured: boolean;
  keyCheck: { result: string } | null;
}

export interface BrainModelOption {
  id: string;
  label: string;
  price?: unknown;
}

/** O que a tela mostra de quem lê a ligação, calculado só aqui para o teste alcançar cada regra. */
export interface AnalysisView {
  /** O cérebro escolhido, ou `""` fora da escolha de cérebro. */
  brain: string;
  /** O modelo escolhido, ou `""`. */
  modelId: string;
  /** Os cérebros que o seletor oferece: configurados e com chave aceita. */
  accepted: BrainOption[];
  /** Os modelos do cérebro escolhido; vazia enquanto a lista carrega. */
  models: BrainModelOption[];
  /** O modelo escolhido, se ele está na lista do cérebro. */
  model: BrainModelOption | undefined;
  /** O cérebro escolhido está sem chave aceita (só com a lista de cérebros carregada). */
  keyGone: boolean;
  /** O modelo escolhido saiu da lista do cérebro (só com a lista de modelos carregada e a chave aceita). */
  modelGone: boolean;
  /** O aviso de modelo sem preço: o escolhido está na lista sem preço, e a chave não sumiu. */
  unmeasured: boolean;
  /** O seletor de Modelo barra o salvar (ver `modelRequired`). */
  required: boolean;
  /** O rótulo de um cérebro pela lista; o id quando ele não está nela, ou a lista não carregou. */
  labelOf(id: string): string;
  /** Se escolher este modelo agora mostra o aviso de sem preço (o `acceptUnmeasured` do `onChange`). */
  unmeasuredOf(id: string): boolean;
}

/**
 * As regras dos avisos de quem lê a ligação. `brains` e `models` chegam `undefined` enquanto a lista
 * carrega e para quem só lê: lista que não chegou nunca acende aviso. O cérebro sem chave aceita, ou o
 * modelo que saiu da lista: a rotina não lê a ligação deste agente, nem passa para a escolha da
 * organização ou para o motor.
 */
export function analysisView({
  analysis,
  brains,
  models,
}: {
  analysis: AnalysisDraft;
  brains: BrainOption[] | undefined;
  models: BrainModelOption[] | undefined;
}): AnalysisView {
  const brain = analysis.kind === "brain" ? analysis.brain : "";
  const modelId = analysis.kind === "brain" ? analysis.model : "";
  const accepted = (brains ?? []).filter((option) => option.configured && option.keyCheck?.result === "accepted");
  const list = models ?? [];
  const model = list.find((item) => item.id === modelId);
  const keyGone = brain !== "" && brains !== undefined && !accepted.some((option) => option.id === brain);
  const modelGone = brain !== "" && !keyGone && modelId !== "" && models !== undefined && model === undefined;
  return {
    brain,
    modelId,
    accepted,
    models: list,
    model,
    keyGone,
    modelGone,
    unmeasured: model !== undefined && model.price === undefined && !keyGone,
    required: modelRequired(analysis),
    labelOf: (id) => brains?.find((option) => option.id === id)?.label ?? id,
    unmeasuredOf: (id) => {
      const next = list.find((item) => item.id === id);
      return next !== undefined && next.price === undefined;
    },
  };
}
