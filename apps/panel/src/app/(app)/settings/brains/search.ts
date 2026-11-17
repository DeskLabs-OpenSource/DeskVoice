/** Sem acento e sem caixa, como o `ModelPicker` da referência: "Gêmeos" acha "gemeos", "GPT" acha "gpt". */
export const searchable = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Os modelos cujo nome ou id contém a busca, ignorando acento e caixa. Busca vazia devolve todos. */
export function matchModels<T extends { id: string; label: string }>(models: readonly T[], query: string): T[] {
  const needle = searchable(query.trim());
  return needle ? models.filter((model) => searchable(`${model.label} ${model.id}`).includes(needle)) : [...models];
}
