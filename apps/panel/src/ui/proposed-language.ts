/** Os idiomas que o painel tem: o mesmo `check` de `organizations.language` (`SPOKEN_LANGUAGES` no core). */
const LANGUAGES = ["pt-BR", "en", "es"] as const;
export type OrganizationLanguage = (typeof LANGUAGES)[number];

/**
 * O idioma que o formulário de agente novo e o de menu novo propõem (R8, fatia 8a): o da organização
 * (`organizations.language`, a cópia que `addOrganization` fez do padrão da instalação na criação,
 * e que chega por `GET /auth/me`), e pt-BR sem ele, como sempre. Nunca o padrão da instalação lido na
 * hora: mudar o padrão não muda o que uma organização que já existe propõe. Só a proposta: agente e
 * menu que já existem continuam com o idioma deles.
 */
export function proposedLanguage(organizationLanguage: unknown): OrganizationLanguage {
  return LANGUAGES.find((language) => language === organizationLanguage) ?? "pt-BR";
}
