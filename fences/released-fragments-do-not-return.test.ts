// dono: @DeskLabs-OpenSource/maintainers
// motivo: um PR aberto antes de uma versão pode trazer de volta, editado ou recriado, um fragmento
//   que essa versão já consumiu e apagou (quase entrou no #511 e no #538); entrando, o item sairia
//   repetido na nota da versão seguinte, e só leitura à mão pegava.
// revisar em: 2027-05-21
//
// Como detecta: pelo título. A release transforma cada fragmento na linha `- **<título>** …` sob
// `## [X.Y.Z]` do CHANGELOG.md e apaga o arquivo no mesmo commit; então um fragmento em `.changes/`
// cujo título já abre um item do CHANGELOG é um fragmento publicado que voltou. Lê só a árvore,
// sem `git log`: funciona com o checkout raso do CI (`fetch-depth` 1) e numa cópia sem `.git`.
// Pelo nome do arquivo apagado em `chore(release): …` exigiria o histórico inteiro no job.
// O que ela não pega: o fragmento publicado que volta com o título trocado. Nos dois casos medidos
// (#511 e #538) o título veio igual, porque o PR só mexia no corpo.
import { describe, it, expect } from "vitest";
import { parseFragment } from "../scripts/release/fragment";
import { REPO_ROOT, exists, expectClean, fixture, listFiles, read } from "./_lib";

const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\]/;

/** Título de cada item do CHANGELOG → a versão mais nova em que ele saiu. */
function publishedTitles(changelog: string): Map<string, string> {
  const titles = new Map<string, string>();
  let version: string | null = null;
  for (const line of changelog.split("\n")) {
    const heading = VERSION_HEADING.exec(line);
    if (heading) {
      version = heading[1] ?? null;
      continue;
    }
    const title = /^- \*\*(.+?)\*\*(?:\s|$)/.exec(line)?.[1];
    // O CHANGELOG vem do mais novo para o mais antigo: a primeira versão vista é a mais recente.
    if (version && title && !titles.has(title)) titles.set(title, version);
  }
  return titles;
}

function check(root: string): string[] {
  if (!exists(root, "CHANGELOG.md")) return [];
  const published = publishedTitles(read(root, "CHANGELOG.md"));
  const violations: string[] = [];
  for (const file of listFiles(root, ".changes", (f) => f.endsWith(".md") && f !== ".changes/README.md")) {
    let title: string;
    try {
      title = parseFragment(file, read(root, file)).title;
    } catch {
      continue; // fragmento malformado é da cerca release-fragments-are-valid
    }
    const version = published.get(title);
    if (version) {
      violations.push(`${file}: este fragmento já saiu na versão ${version} (título "${title}" no CHANGELOG.md); apague-o do PR`);
    }
  }
  return violations;
}

describe("released-fragments-do-not-return", () => {
  it("nenhum fragmento em .changes/ já saiu numa versão", () => {
    expectClean(
      check(REPO_ROOT),
      "A versão já publicou e apagou este fragmento; mantê-lo repete o item na próxima nota. Apague o arquivo do PR. Se a mudança é nova de verdade, dê a ela um título que ainda não está no CHANGELOG.md.",
    );
  });

  it("reprova o fragmento da latência de volta depois da 0.45.0 e o do prazo do webhook depois da 0.44.0, e deixa passar o novo", () => {
    expect(check(fixture("released-fragments-do-not-return"))).toEqual([
      '.changes/latencia-por-turno.md: este fragmento já saiu na versão 0.45.0 (título "A tela da ligação mostra quanto o agente demorou para responder" no CHANGELOG.md); apague-o do PR',
      '.changes/webhook-prazo.md: este fragmento já saiu na versão 0.44.0 (título "Cada webhook permitido ganha o seu prazo de resposta, de 1 a 30 segundos" no CHANGELOG.md); apague-o do PR',
    ]);
  });
});
