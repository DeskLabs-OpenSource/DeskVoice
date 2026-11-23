// dono: @DeskLabs-OpenSource/maintainers
// motivo: quando um bloco do painel muda de tela, o lugar antigo mostra "mudou para…" por uma versão
//   só (central de configuração, parte 7, #520). Sem trava, o aviso fica para sempre: ninguém
//   lembra de tirá-lo, e a revisora pediu que a versão de saída ficasse presa num teste.
// revisar em: 2027-05-23
//
// Como detecta: pelo título do fragmento que publicou a mudança. A release transforma o fragmento
// na linha `- **<título>** …` sob `## [X.Y.Z]` do CHANGELOG.md; essa X.Y.Z é a versão que levou o
// aviso. Se o CHANGELOG já tem uma versão mais nova que ela e a chave do aviso ainda aparece no
// código do painel, a cerca reprova. Na prática, quem a vê vermelha é o PR da versão seguinte
// (`chore(release): …`), que escreve a seção nova: o aviso sai antes desse corte.
// Lê só a árvore, sem `git log` nem tag: funciona com o checkout raso do CI.
// O que ela não pega: o aviso que volta com outra chave, e um título de fragmento trocado à mão no
// CHANGELOG (então a versão não é achada e a cerca passa calada).
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { REPO_ROOT, exists, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";

/** Cada "mudou para…": o título do fragmento que o publicou e as chaves de dicionário que o mostram. */
const MOVED_NOTICES = [
  {
    title: 'A ligação pelo WhatsApp passa para a tela "Linha telefônica", e o aviso de gravação para "Privacidade e dados"',
    keys: ["movedWhatsAppCalls", "movedRecordingNotice"],
  },
] as const;

const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\]/;

/** As versões do CHANGELOG, da mais nova para a mais antiga, e a versão de cada título de item. */
function releases(changelog: string): { versions: string[]; titleVersion: Map<string, string> } {
  const versions: string[] = [];
  const titleVersion = new Map<string, string>();
  for (const line of changelog.split("\n")) {
    const heading = VERSION_HEADING.exec(line);
    if (heading?.[1]) {
      versions.push(heading[1]);
      continue;
    }
    const title = /^- \*\*(.+?)\*\*(?:\s|$)/.exec(line)?.[1];
    const current = versions.at(-1);
    if (current && title && !titleVersion.has(title)) titleVersion.set(title, current);
  }
  return { versions, titleVersion };
}

function check(root: string): string[] {
  if (!exists(root, "CHANGELOG.md")) return [];
  const { versions, titleVersion } = releases(read(root, "CHANGELOG.md"));
  const newest = versions[0];
  const sources = listFiles(root, "apps/panel/src", (f) => isSource(f) && !isTest(f));
  const violations: string[] = [];
  for (const moved of MOVED_NOTICES) {
    const shipped = titleVersion.get(moved.title);
    if (!shipped || shipped === newest) continue; // ainda não saiu, ou é a versão que leva o aviso
    for (const file of sources) {
      const text = read(root, file);
      for (const key of moved.keys) {
        if (new RegExp(`\\b${key}\\b`).test(text)) {
          violations.push(`${file}: "${key}" é o "mudou para…" que saiu na ${shipped}; a ${newest} já vem depois, e o aviso fica só uma versão`);
        }
      }
    }
  }
  return violations;
}

describe("moved-notice-leaves-after-one-version", () => {
  it('nenhum "mudou para…" passa da versão que o levou', () => {
    expectClean(
      check(REPO_ROOT),
      'O lugar antigo mostra o "mudou para…" só na versão que publicou a mudança. Tire o aviso (a chave, o uso na tela e o teste de tela) num PR antes de cortar a versão seguinte, e apague a entrada em MOVED_NOTICES.',
    );
  });

  it("reprova o aviso da parte 7 depois da versão que o levou, e deixa passar enquanto ela é a última ou antes de sair", () => {
    const root = fixture("moved-notice-leaves-after-one-version");
    expect(check(root)).toEqual([
      'apps/panel/src/app/settings/calls/page.tsx: "movedRecordingNotice" é o "mudou para…" que saiu na 0.45.1; a 0.45.2 já vem depois, e o aviso fica só uma versão',
      'apps/panel/src/i18n/pt-BR/settings.ts: "movedWhatsAppCalls" é o "mudou para…" que saiu na 0.45.1; a 0.45.2 já vem depois, e o aviso fica só uma versão',
      'apps/panel/src/i18n/pt-BR/settings.ts: "movedRecordingNotice" é o "mudou para…" que saiu na 0.45.1; a 0.45.2 já vem depois, e o aviso fica só uma versão',
    ]);

    const changelog = path.join(root, "CHANGELOG.md");
    const full = fs.readFileSync(changelog, "utf8");
    // A 0.45.1 é a última: o aviso ainda está na versão dele.
    fs.writeFileSync(changelog, full.replace(/## \[0\.45\.2\][\s\S]*?(?=## \[0\.45\.1\])/, ""));
    expect(check(root)).toEqual([]);
    // O fragmento ainda não saiu em versão nenhuma.
    fs.writeFileSync(changelog, full.replace(/- \*\*A ligação pelo WhatsApp passa[^\n]*\n/, ""));
    expect(check(root)).toEqual([]);
  });
});
