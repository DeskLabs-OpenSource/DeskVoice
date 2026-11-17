import { z } from "zod";

/**
 * O analista ao vivo (desenho `docs/specs/2026-11-17-analistas-ao-vivo.md`, seção 3.1): configuração
 * do operador, com o modelo de decisão que ele usa, a temperatura e as objeções com a orientação que
 * o agente recebe. A regra mora aqui, num lugar só: a rota valida com ela ao salvar, e a ligação
 * valida de novo ao ler (`analystObjectionsOf`).
 *
 * Sem dependência de banco: a tela pode importar este arquivo direto.
 */

export const ANALYST_NAME_MAX = 40;
export const ANALYST_OBJECTIONS_MAX = 8;
export const ANALYST_OBJECTION_KEY = /^[a-z0-9_]{1,30}$/;
export const ANALYST_LABEL_MAX = 60;
export const ANALYST_GUIDANCE_MAX = 280;
/** A opção "nenhuma objeção" da pergunta ao modelo. Nenhuma objeção do operador pode ter essa chave. */
export const ANALYST_NO_OBJECTION = "none";

export const analystObjectionSchema = z.object({
  key: z
    .string()
    .regex(ANALYST_OBJECTION_KEY, "must be 1 to 30 lowercase letters, digits or '_'")
    .refine((key) => key !== ANALYST_NO_OBJECTION, `'${ANALYST_NO_OBJECTION}' is reserved`),
  label: z.string().trim().min(1).max(ANALYST_LABEL_MAX),
  guidance: z.string().trim().min(1).max(ANALYST_GUIDANCE_MAX),
});
export type AnalystObjection = z.output<typeof analystObjectionSchema>;

export const analystObjectionsSchema = z
  .array(analystObjectionSchema)
  .max(ANALYST_OBJECTIONS_MAX)
  .refine((items) => new Set(items.map((item) => item.key)).size === items.length, "objection keys must be unique");

export const analystNameSchema = z.string().trim().min(1).max(ANALYST_NAME_MAX);

/**
 * Os campos que o operador escreve. `decisionModel` aqui é só o formato: se o modelo está instalado
 * quem confere é a rota, que conhece os modelos desta instalação.
 */
export const analystFieldsSchema = z.object({
  name: analystNameSchema,
  decisionModel: z.string().trim().min(1).max(80),
  temperature: z.boolean(),
  objections: analystObjectionsSchema,
});
export type AnalystFields = z.output<typeof analystFieldsSchema>;

/**
 * As objeções gravadas, conferidas de novo ao ler. Linha que não passa (posta por fora da API, ou de
 * uma regra mais antiga) vale como nenhuma objeção: a ligação segue sem orientação, nunca com um texto
 * que a regra recusaria.
 */
export function analystObjectionsOf(stored: unknown): AnalystObjection[] {
  const parsed = analystObjectionsSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}
