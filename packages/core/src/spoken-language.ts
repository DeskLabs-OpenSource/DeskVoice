/**
 * O idioma em que o sistema fala por conta própria: o aviso da caixa postal, a saudação da passagem
 * entre agentes e as falas das ferramentas de agenda (issue #348).
 *
 * O campo "Idioma da conversa" do agente é texto livre, e quem configura escreve o rótulo inteiro
 * (`en-US`, `es-MX`), que é o que o motor de voz entende. As falas fixas, porém, existem gravadas ou
 * traduzidas em três idiomas: o que se escolhe aqui é o idioma que elas falam, e não o rótulo com
 * região. Por isso o prefixo vale (`en-US` → `en`, `es-MX` → `es`) e este é o único lugar que
 * conhece a lista: os três pontos que escolhem idioma chamam `spokenLanguageOf`, porque um mapa
 * copiado à mão já divergiu uma vez (o segundo e o terceiro copiaram o do primeiro, cada um com a
 * sua queda para o pt-BR).
 */
export const SPOKEN_LANGUAGES = ["pt-BR", "en", "es"] as const;
export type SpokenLanguage = (typeof SPOKEN_LANGUAGES)[number];
/** O idioma falado de fábrica: o mesmo de uma instalação que nunca configurou nada. */
export const DEFAULT_SPOKEN_LANGUAGE: SpokenLanguage = "pt-BR";

/** O idioma de um rótulo BCP 47: só a parte antes da região (`en-US` → `en`). */
const baseOf = (tag: string): string => tag.split("-")[0] ?? "";

/**
 * O idioma falado de um valor lido da configuração, em `xx-YY` ou `xx`.
 *
 * `pt` cai no português que o produto fala (`pt-BR`), que é o único português gravado. Ausente,
 * vazio, texto que não é idioma ou idioma que as falas não têm caem no padrão do produto — e nunca
 * lançam: o valor vem de um campo de tela em que a pessoa digita o que quiser.
 */
export function spokenLanguageOf(stored: unknown): SpokenLanguage {
  if (typeof stored !== "string") return DEFAULT_SPOKEN_LANGUAGE;
  const tag = stored.trim().toLowerCase();
  if (tag === "") return DEFAULT_SPOKEN_LANGUAGE;
  const exact = SPOKEN_LANGUAGES.find((language) => language.toLowerCase() === tag);
  if (exact) return exact;
  const base = baseOf(tag);
  const byPrefix = SPOKEN_LANGUAGES.find((language) => baseOf(language).toLowerCase() === base);
  return byPrefix ?? DEFAULT_SPOKEN_LANGUAGE;
}
