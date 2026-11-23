// dono: @DeskLabs-OpenSource/maintainers
// motivo: a sessão de suporte da instalação (`users.kind = 'support'`, R8 seção 3.6) entra numa
//   organização como `admin`. Uma rota de escrita nova que ninguém classificou herdaria todos os
//   poderes de um `admin`, inclusive criar convite, link ou credencial que dura mais que a sessão.
// revisar em: 2027-05-17
import { describe, expect, it } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";
import { SUPPORT_SESSION_ROUTES, type SupportSessionRoute } from "./support-session-routes";

const API = "apps/panel/src/app/api/v1/";
const WRITE_EXPORT = /^export\s+(?:const|async\s+function|function)\s+(POST|PUT|PATCH|DELETE)\b/gm;
const REEXPORT = /^export\s*\{([^}]*)\}/gm;
const SUPPORT_FALSE = /\bsupport\s*:\s*false\b/;
const MIN_REASON = 15;

/** O código sem comentários: um `// support: false` não recusa nada. URLs (`https://`) ficam. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

interface WriteMethod {
  route: string;
  method: string;
  /** O trecho do arquivo desde o `export` do método até o próximo `export`. */
  code: string;
}

/** Cada método de escrita exportado por um `route.ts` do painel, com o trecho que o define. */
export function writeMethods(root: string): WriteMethod[] {
  const out: WriteMethod[] = [];
  for (const file of listFiles(root, API.slice(0, -1), (f) => f.endsWith("/route.ts"))) {
    const route = file.slice(API.length, -"/route.ts".length);
    const source = withoutComments(read(root, file));
    const starts = [...source.matchAll(/^export\b/gm)].map((m) => m.index);
    for (const match of source.matchAll(WRITE_EXPORT)) {
      const end = starts.find((start) => start > match.index) ?? source.length;
      out.push({ route, method: match[1] ?? "", code: source.slice(match.index, end) });
    }
    // `export { POST } from "..."`: o método existe, mas o trecho que o define está noutro arquivo.
    for (const match of source.matchAll(REEXPORT)) {
      for (const name of (match[1] ?? "").split(",").map((part) => part.trim().split(/\s+as\s+/).pop() ?? "")) {
        if (/^(POST|PUT|PATCH|DELETE)$/.test(name)) out.push({ route, method: name, code: "" });
      }
    }
  }
  return out;
}

export function check(root: string, table: SupportSessionRoute[]): string[] {
  const violations: string[] = [];
  const key = (route: string, method: string): string => `${method} ${route}`;
  const rows = new Map<string, SupportSessionRoute>();
  for (const row of table) {
    const id = key(row.route, row.method);
    if (rows.has(id)) violations.push(`${id}: aparece duas vezes na tabela`);
    rows.set(id, row);
    if (row.reason.trim().length < MIN_REASON) violations.push(`${id}: a linha da tabela não diz o motivo`);
    if (row.rule === "allow" && /^team(\/|$)/.test(row.route)) violations.push(`${id}: toda rota de team/** é \`forbid\``);
  }
  const seen = new Set<string>();
  for (const { route, method, code } of writeMethods(root)) {
    const id = key(route, method);
    seen.add(id);
    const row = rows.get(id);
    const refuses = SUPPORT_FALSE.test(code);
    if (!row) violations.push(`${id}: rota de escrita fora da tabela fences/support-session-routes.ts`);
    else if (row.rule === "forbid" && !refuses) violations.push(`${id}: a tabela diz \`forbid\`, mas o método não passa \`support: false\``);
    else if (row.rule === "allow" && refuses) violations.push(`${id}: a tabela diz \`allow\`, mas o método passa \`support: false\``);
  }
  for (const id of rows.keys()) if (!seen.has(id)) violations.push(`${id}: a linha da tabela aponta para rota que não existe`);
  return violations.sort();
}

describe("support-session-routes-are-classified", () => {
  it("toda rota de escrita do painel está na tabela, e a `forbid` recusa a sessão de suporte", () => {
    expectClean(
      check(REPO_ROOT, SUPPORT_SESSION_ROUTES),
      "Toda rota do painel com POST, PUT, PATCH ou DELETE tem uma linha em fences/support-session-routes.ts, com `forbid` ou `allow` e o motivo. A pergunta é: esta ação cria credencial, convite ou acesso que sobrevive ao fim da sessão de suporte, ou mexe na equipe ou na conta? Sim, ou na dúvida, é `forbid`, e o método passa `support: false` ao `handle` (ou `handlePublic`, `handleInstallation`, `requireRole`). Diga a classificação no PR.",
    );
  });

  it("a tabela tem as recusas que o desenho manda", () => {
    const forbidden = new Set(SUPPORT_SESSION_ROUTES.filter((row) => row.rule === "forbid").map((row) => `${row.method} ${row.route}`));
    for (const id of [
      "POST team/invites",
      "DELETE team/invites/[id]",
      "PATCH team/users/[id]",
      "DELETE team/users/[id]",
      "POST invites/[token]/accept",
      "POST installation/organizations/[id]/invite",
      "POST auth/password",
      "PATCH auth/me",
      "POST calls/[id]/share",
    ]) {
      expect(forbidden, id).toContain(id);
    }
  });

  it("reprova a rota fora da tabela, a `forbid` sem recusa, o `allow` em team/**, a linha sem motivo e a que sobrou", () => {
    const root = fixture("support-session-routes-are-classified");
    const table: SupportSessionRoute[] = [
      { route: "team/invites", method: "POST", rule: "forbid", reason: "o convite sobrevive à sessão de suporte" },
      { route: "team/members", method: "POST", rule: "allow", reason: "rota da equipe classificada como permitida" },
      { route: "calls/[id]/share", method: "POST", rule: "forbid", reason: "o link público sobrevive à sessão" },
      { route: "calls/[id]/share", method: "DELETE", rule: "allow", reason: "revoga o link, não cria acesso" },
      { route: "auth/me", method: "PATCH", rule: "allow", reason: "x" },
      { route: "auth/me", method: "PATCH", rule: "allow", reason: "a mesma linha outra vez na tabela" },
      { route: "gone", method: "PUT", rule: "allow", reason: "rota que já não existe no disco" },
    ];
    expect(check(root, table)).toEqual([
      "DELETE reexported: rota de escrita fora da tabela fences/support-session-routes.ts",
      "PATCH auth/me: a linha da tabela não diz o motivo",
      "PATCH auth/me: a tabela diz `allow`, mas o método passa `support: false`",
      "PATCH auth/me: aparece duas vezes na tabela",
      "POST calls/[id]/share: a tabela diz `forbid`, mas o método não passa `support: false`",
      "POST team/members: toda rota de team/** é `forbid`",
      "PUT brand-new: rota de escrita fora da tabela fences/support-session-routes.ts",
      "PUT gone: a linha da tabela aponta para rota que não existe",
    ]);
  });
});
