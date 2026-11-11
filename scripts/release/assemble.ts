/**
 * Fragmentos → seção do `CHANGELOG.md`. Módulo puro: a data entra por parâmetro.
 */
import type { Fragment, Section } from "./fragment";

export const ATTENTION_TITLE = "### Requer atenção";

const SECTION_TITLES: Record<Section, string> = {
  added: "### Adicionado",
  changed: "### Alterado",
  fixed: "### Corrigido",
};

const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\]/;
const EMPTY_CHANGELOG = "# Changelog\n\nO que muda em cada versão do DeskVoice, na voz de quem opera a instalação.\nEste arquivo é montado a partir de `.changes/`; não edite à mão.\n";

/** `- **título** texto`, com as linhas seguintes recuadas para continuarem no mesmo item. */
function item(title: string, text: string): string {
  const [first = "", ...others] = text.split("\n");
  return [`- **${title}** ${first}`.trimEnd(), ...others.map((line) => (line.trim() ? `  ${line}` : ""))].join("\n");
}

export function assembleSection(fragments: readonly Fragment[], version: string, date: string): string {
  if (fragments.length === 0) throw new Error("nenhum fragmento: não há seção a montar");
  const ordered = [...fragments].sort((a, b) => a.file.localeCompare(b.file));
  const parts = [`## [${version}] - ${date}`];

  // O aviso vem primeiro e sob um título só: é o que o operador precisa ler antes de atualizar.
  const withAttention = ordered.filter((fragment) => fragment.attention);
  if (withAttention.length > 0) {
    parts.push(ATTENTION_TITLE, withAttention.map((fragment) => item(fragment.title, fragment.attention ?? "")).join("\n"));
  }
  for (const section of Object.keys(SECTION_TITLES) as Section[]) {
    const inSection = ordered.filter((fragment) => fragment.section === section);
    if (inSection.length > 0) parts.push(SECTION_TITLES[section], inSection.map((fragment) => item(fragment.title, fragment.body)).join("\n"));
  }
  return parts.join("\n\n");
}

/** A versão mais nova do CHANGELOG, ou `null` se ele ainda não tem nenhuma. */
export function latestVersion(changelog: string): string | null {
  for (const line of changelog.split("\n")) {
    const version = VERSION_HEADING.exec(line)?.[1];
    if (version) return version;
  }
  return null;
}

/** Insere a seção acima da versão anterior (ou ao fim do cabeçalho, na primeira versão). */
export function applyToChangelog(changelog: string, section: string): string {
  const lines = (changelog.trim() ? changelog : EMPTY_CHANGELOG).trimEnd().split("\n");
  const at = lines.findIndex((line) => VERSION_HEADING.test(line));
  const head = (at === -1 ? lines : lines.slice(0, at)).join("\n").trimEnd();
  const tail = at === -1 ? "" : `\n\n${lines.slice(at).join("\n")}`;
  return `${head}\n\n${section}${tail}\n`;
}

/** O texto de uma versão, sem a linha do título: vira a nota da release no GitHub. */
export function extractSection(changelog: string, version: string): string | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => VERSION_HEADING.exec(line)?.[1] === version);
  if (start === -1) return null;
  const length = lines.slice(start + 1).findIndex((line) => VERSION_HEADING.test(line));
  return lines.slice(start + 1, length === -1 ? undefined : start + 1 + length).join("\n").trim();
}
