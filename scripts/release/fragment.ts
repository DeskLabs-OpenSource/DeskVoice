/**
 * O fragmento que cada mudança traz em `.changes/<slug>.md`: leitura e validação.
 *
 * O autor declara o EFEITO para quem já opera uma instalação, nunca o número da versão. Pedir
 * "isto é minor?" convida ao erro (todo conserto muda comportamento visível); perguntar "o operador
 * precisa fazer alguma coisa?" não tem como ser respondido errado por quem sabe o que fez.
 *
 * Módulo puro: recebe texto, devolve dado. Quem toca disco é `scripts/release.ts`.
 */
export const IMPACTS = ["nothing_changes", "new_capability", "operator_action"] as const;
export type Impact = (typeof IMPACTS)[number];

export const SECTIONS = ["added", "changed", "fixed"] as const;
export type Section = (typeof SECTIONS)[number];

export interface Fragment {
  /** Nome do arquivo, para a mensagem de erro apontar o culpado. */
  file: string;
  impact: Impact;
  section: Section;
  title: string;
  /** Um parágrafo, na voz de quem opera a instalação, com o crédito ao autor. */
  body: string;
  /** O que o operador precisa fazer. Presente se, e só se, `impact` é `operator_action`. */
  attention: string | null;
}

export class InvalidFragment extends Error {}

const ATTENTION_HEADING = /^##\s+Requer atenção\s*$/i;
const CREDIT = /Crédito:\s*@[\w-]+/;
const FIELDS = ["impact", "section", "title"];

function oneOf<T extends string>(field: string, value: string | undefined, allowed: readonly T[]): T {
  const found = allowed.find((item) => item === value);
  if (found) return found;
  const options = `${allowed.slice(0, -1).join(", ")} ou ${allowed.at(-1)}`;
  throw new InvalidFragment(value ? `\`${field}\` é \`${value}\`; use ${options}` : `falta \`${field}\` (${options})`);
}

function splitFrontmatter(text: string): { fields: Record<string, string>; rest: string[] } {
  const lines = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") throw new InvalidFragment("a primeira linha precisa ser `---` (abre o frontmatter)");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) throw new InvalidFragment("falta o `---` que fecha o frontmatter");

  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    const key = line.slice(0, separator).trim();
    if (separator === -1 || !FIELDS.includes(key)) {
      throw new InvalidFragment(`linha de frontmatter desconhecida: \`${line.trim()}\` (os campos são ${FIELDS.join(", ")})`);
    }
    const value = line.slice(separator + 1).trim();
    // Só tira aspas que formam par: `"Quero 2" volta a funcionar` não é um valor entre aspas.
    fields[key] = /^(["'])(.*)\1$/.exec(value)?.[2] ?? value;
  }
  return { fields, rest: lines.slice(end + 1) };
}

export function parseFragment(file: string, text: string): Fragment {
  const { fields, rest } = splitFrontmatter(text);
  const impact = oneOf("impact", fields.impact, IMPACTS);
  const section = oneOf("section", fields.section, SECTIONS);
  const title = fields.title ?? "";
  if (!title) throw new InvalidFragment("falta `title`: é a frase em negrito que abre a nota");

  const attentionAt = rest.findIndex((line) => ATTENTION_HEADING.test(line.trim()));
  const bodyLines = attentionAt === -1 ? rest : rest.slice(0, attentionAt);
  const attentionLines = attentionAt === -1 ? [] : rest.slice(attentionAt + 1);

  // Título dentro do fragmento quebraria a seção montada no CHANGELOG, que é feita de títulos.
  const heading = [...bodyLines, ...attentionLines].find((line) => line.startsWith("#"));
  if (heading) throw new InvalidFragment(`título dentro do fragmento (\`${heading.trim()}\`); o único aceito é \`## Requer atenção\``);

  const body = bodyLines.join("\n").trim();
  if (!body) throw new InvalidFragment("corpo vazio: é ele que o dono da instalação lê antes de atualizar");
  if (/\n\s*\n/.test(body)) throw new InvalidFragment("o corpo é um parágrafo só; detalhes vão no PR, não na nota de versão");
  if (!CREDIT.test(body)) throw new InvalidFragment("falta o crédito ao autor no corpo: termine com `Crédito: @usuario.`");

  const attention = attentionLines.join("\n").trim() || null;
  if (impact === "operator_action" && !attention) {
    throw new InvalidFragment("`impact: operator_action` sem bloco `## Requer atenção`: o operador precisa saber o que fazer");
  }
  if (attention && impact !== "operator_action") {
    throw new InvalidFragment(`bloco \`## Requer atenção\` com \`impact: ${impact}\`: se há algo a fazer, o impacto é \`operator_action\``);
  }

  return { file, impact, section, title, body, attention };
}
