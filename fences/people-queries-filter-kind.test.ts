// dono: @DeskLabs-OpenSource/maintainers
// motivo: o vínculo de suporte da instalação (`users.kind = 'support'`, R8 seção 3.6) mora em
//   `users` junto com a equipe. Uma consulta nova que escolhe, conta ou lista pessoas sem filtrar
//   `kind = 'member'` faria quem dá suporte receber resumo, virar responsável ou contar como dono.
// revisar em: 2027-05-17
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";
import { PEOPLE_QUERIES_ALLOWLIST, type PeopleQueryException } from "./people-queries-allowlist";

// `accounts.ts` é a porta das contas: ela cria e lê vínculos de qualquer `kind` de propósito.
const EXEMPT = new Set(["packages/core/src/accounts.ts"]);
// Auxiliares de teste montam organizações inteiras: ficam fora, como os próprios testes.
const isTestSupport = (file: string): boolean => isTest(file) || /(^|\/)testing\//.test(file);

// Palavras que, logo depois de `users`, não são apelido da tabela.
const NOT_ALIAS = new Set([
  "where", "on", "using", "order", "group", "limit", "offset", "for", "join", "left", "right", "inner", "full", "cross",
  "natural", "union", "returning", "set", "having", "window", "except", "intersect", "and", "or", "fetch",
]);
const READS_USERS = /\b(?:from|join)\s+(?:public\.)?"?users"?(?![\w.])(?:\s+(?:as\s+)?([a-z_]\w*))?/gi;

/** O texto de cada literal de texto (aspas simples, duplas e crase) do arquivo, sem os comentários. */
export function stringLiterals(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  let last = ""; // último caractere significativo fora de literal, para separar regex de divisão
  const n = source.length;

  const readQuoted = (quote: string): string => {
    let text = "";
    i++;
    while (i < n && source[i] !== quote) {
      if (source[i] === "\\") {
        // A aspa e a barra escapadas valem pelo caractere: é assim que a consulta chega ao banco.
        text += /["'\\]/.test(source[i + 1] ?? "") ? source[i + 1] : source.slice(i, i + 2);
        i += 2;
      } else {
        text += source[i++];
      }
    }
    i++;
    return text;
  };

  const readTemplate = (): string => {
    let text = "";
    i++;
    while (i < n && source[i] !== "`") {
      if (source[i] === "\\") {
        text += source.slice(i, i + 2);
        i += 2;
      } else if (source[i] === "$" && source[i + 1] === "{") {
        // A expressão interpolada fica no texto como `${...}`; literais dentro dela também saem.
        const start = i;
        i += 2;
        scan(1);
        text += source.slice(start, i);
      } else {
        text += source[i++];
      }
    }
    i++;
    return text;
  };

  // Varre código até fechar `depth` chaves (0 = até o fim do arquivo).
  const scan = (depth: number): void => {
    while (i < n) {
      const c = source.charAt(i);
      const next = source.charAt(i + 1);
      if (c === "/" && next === "/") {
        while (i < n && source[i] !== "\n") i++;
      } else if (c === "/" && next === "*") {
        const end = source.indexOf("*/", i + 2);
        i = end === -1 ? n : end + 2;
      } else if (c === "'" || c === '"') {
        out.push(readQuoted(c));
        last = c;
      } else if (c === "`") {
        out.push(readTemplate());
        last = "`";
      } else if (c === "/" && (last === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /\breturn$/.test(source.slice(Math.max(0, i - 8), i).trimEnd()))) {
        // Regex: pula até a barra que fecha, fora de classe de caracteres.
        let inClass = false;
        i++;
        while (i < n && (source[i] !== "/" || inClass) && source[i] !== "\n") {
          if (source[i] === "\\") i++;
          else if (source[i] === "[") inClass = true;
          else if (source[i] === "]") inClass = false;
          i++;
        }
        i++;
        last = "/";
      } else {
        if (c === "{" && depth > 0) depth++;
        if (c === "}" && depth > 0 && --depth === 0) {
          i++;
          return;
        }
        if (!/\s/.test(c)) last = c;
        i++;
      }
    }
  };

  scan(0);
  return out;
}

/** Os apelidos de `users` lidos no literal que não têm `kind = 'member'` (`null` = sem apelido). */
export function unfilteredReads(sql: string): Array<string | null> {
  const missing: Array<string | null> = [];
  for (const match of sql.matchAll(READS_USERS)) {
    const word = match[1]?.toLowerCase();
    const alias = word && !NOT_ALIAS.has(word) ? word : null;
    const bare = /(?<![\w.])kind\s*=\s*'member'/i.test(sql);
    const qualified = alias !== null && new RegExp(`\\b${alias}\\.kind\\s*=\\s*'member'`, "i").test(sql);
    if (!bare && !qualified) missing.push(alias);
  }
  return missing;
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

function check(root: string, allowlist: PeopleQueryException[]): string[] {
  const violations: string[] = [];
  const used = new Set<PeopleQueryException>();
  const files = [...listFiles(root, "packages", isSource), ...listFiles(root, "apps", isSource)].filter(
    (file) => !EXEMPT.has(file) && !isTestSupport(file),
  );
  for (const file of files) {
    for (const literal of stringLiterals(read(root, file))) {
      if (unfilteredReads(literal).length === 0) continue;
      const sql = normalize(literal);
      const allowed = allowlist.filter((entry) => entry.file === file && sql.includes(normalize(entry.query)));
      if (allowed.length === 0) violations.push(`${file}: lê \`users\` sem \`kind = 'member'\`: ${sql.slice(0, 120)}`);
      for (const entry of allowed) used.add(entry);
    }
  }
  for (const entry of allowlist) {
    if (!used.has(entry)) violations.push(`${entry.file}: a exceção "${entry.query}" não acha mais consulta sem filtro (remova a linha)`);
    if (entry.reason.trim().length < 15) violations.push(`${entry.file}: o motivo da exceção "${entry.query}" é curto demais`);
  }
  return violations.sort();
}

describe("people-queries-filter-kind", () => {
  it("toda consulta que lê `users` filtra `kind = 'member'` ou está na lista com motivo", () => {
    expectClean(
      check(REPO_ROOT, PEOPLE_QUERIES_ALLOWLIST),
      "Uma consulta que escolhe, conta, lista ou avisa pessoas da organização filtra `kind = 'member'` na mesma consulta: o vínculo de suporte da instalação (`kind = 'support'`) nunca é destinatário, responsável nem dono. Se a consulta só mostra o nome de quem já agiu ou lê a própria sessão, acrescente a exceção em fences/people-queries-allowlist.ts, com o motivo, e explique no PR.",
    );
  });

  it("reprova a consulta sem filtro, a exceção que sobrou e o motivo curto; aceita a filtrada", () => {
    const root = fixture("people-queries-filter-kind");
    const listed: PeopleQueryException = { file: "apps/panel/src/server/names.ts", query: "select u.name from users u where u.id = $1", reason: "mostra o nome de quem agiu" };
    expect(check(root, [listed])).toEqual([
      "apps/panel/src/app/api/v1/leak/route.ts: lê `users` sem `kind = 'member'`: select c.id from users c join users m on m.organization_id = c.organization_id where m.kind = 'member'",
      "apps/panel/src/app/api/v1/leak/route.ts: lê `users` sem `kind = 'member'`: select id from users where disabled_at is null",
      "apps/panel/src/app/api/v1/leak/route.ts: lê `users` sem `kind = 'member'`: select name from users where id in (select actor_id from call_events where kind = 'follow_up_created')",
      "packages/tools/src/leak.ts: lê `users` sem `kind = 'member'`: select whatsapp_e164 from users where organization_id = $1",
    ]);
    expect(check(root, [{ ...listed, reason: "nome" }, { file: "apps/voice/src/gone.ts", query: "from users", reason: "arquivo que já não existe mais" }])).toEqual([
      "apps/panel/src/app/api/v1/leak/route.ts: lê `users` sem `kind = 'member'`: select c.id from users c join users m on m.organization_id = c.organization_id where m.kind = 'member'",
      "apps/panel/src/app/api/v1/leak/route.ts: lê `users` sem `kind = 'member'`: select id from users where disabled_at is null",
      "apps/panel/src/app/api/v1/leak/route.ts: lê `users` sem `kind = 'member'`: select name from users where id in (select actor_id from call_events where kind = 'follow_up_created')",
      "apps/panel/src/server/names.ts: o motivo da exceção \"select u.name from users u where u.id = $1\" é curto demais",
      "apps/voice/src/gone.ts: a exceção \"from users\" não acha mais consulta sem filtro (remova a linha)",
      "packages/tools/src/leak.ts: lê `users` sem `kind = 'member'`: select whatsapp_e164 from users where organization_id = $1",
    ]);
  });

  it("acha o literal em aspas, crase com interpolação e várias linhas, e ignora comentário e regex", () => {
    const source = [
      "// select id from users",
      "/* from users */",
      "const re = /'/g;",
      "const a = 'select 1 from users where id = $1';",
      'const b = "it\\"s from users";',
      "const c = `select ${cols} from",
      "   users u where u.kind = 'member' and ${`inner from users`}`;",
    ].join("\n");
    expect(stringLiterals(source)).toEqual([
      "select 1 from users where id = $1",
      'it"s from users',
      "inner from users",
      "select ${cols} from\n   users u where u.kind = 'member' and ${`inner from users`}",
    ]);
    expect(unfilteredReads("select id from users u where u.kind = 'member'")).toEqual([]);
    expect(unfilteredReads("select id from users where kind = 'member'")).toEqual([]);
    expect(unfilteredReads("select id from users u where x.kind = 'member'")).toEqual(["u"]);
    expect(unfilteredReads("select id from users where role = 'owner'")).toEqual([null]);
    expect(unfilteredReads("select id from users_view")).toEqual([]);
  });
});
