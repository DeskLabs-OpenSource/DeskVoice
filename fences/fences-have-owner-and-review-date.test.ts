// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm travas sobreviviam ao motivo que as criou: ninguém sabia quem podia removê-las
//   nem por que existiam, e PR bom ficava vermelho por regra que já não protegia nada.
// revisar em: 2027-05-10
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

interface Result {
  malformed: string[];
  expired: string[];
}

function check(root: string, today: string): Result {
  const result: Result = { malformed: [], expired: [] };
  for (const file of listFiles(root, "fences", (f) => /^fences\/[^/]+\.test\.ts$/.test(f))) {
    const lines = read(root, file).split("\n");
    const end = lines.findIndex((line) => !line.startsWith("//"));
    const header = lines.slice(0, end === -1 ? lines.length : end).join("\n");
    for (const field of ["dono", "motivo"]) {
      if (!new RegExp(`^// ${field}: \\S`, "m").test(header)) result.malformed.push(`${file}: cabeçalho sem \`${field}:\``);
    }
    const review = /^\/\/ revisar em: (\d{4}-\d{2}-\d{2})\s*$/m.exec(header)?.[1];
    if (!review) result.malformed.push(`${file}: cabeçalho sem \`revisar em: AAAA-MM-DD\``);
    else if (review < today) result.expired.push(`${file}: revisão venceu em ${review}`);
  }
  return result;
}

/** Nunca o relógio da máquina: `FENCE_TODAY` ou a data do último commit. */
function today(): string {
  const fromEnv = process.env.FENCE_TODAY;
  if (fromEnv) return fromEnv;
  return execFileSync("git", ["log", "-1", "--format=%cs"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

describe("fences-have-owner-and-review-date", () => {
  it("toda cerca tem dono, motivo e data de revisão", () => {
    expectClean(
      check(REPO_ROOT, "0000-00-00").malformed,
      "Toda cerca abre com três linhas de comentário: `// dono: @quem-decide`, `// motivo: o erro real que a originou` e `// revisar em: AAAA-MM-DD` (seis meses à frente).",
    );
  });

  it("nenhuma cerca passou da data de revisão", () => {
    const expired = check(REPO_ROOT, today()).expired;
    // Vencimento é estado acumulado, logo é check da main: num PR (ou na fila de merge) só avisa,
    // para o PR de ninguém ficar vermelho sozinho com o passar do tempo.
    if (["pull_request", "merge_group"].includes(process.env.GITHUB_EVENT_NAME ?? "")) {
      for (const line of expired) process.stderr.write(`aviso (não reprova PR): ${line}\n`);
      return;
    }
    expectClean(
      expired,
      "O dono da cerca decide: se ela ainda protege algo, empurre `revisar em` seis meses e diga por quê no commit; se não, apague a cerca e as fixtures dela.",
    );
  });

  it("reprova cerca sem cabeçalho e cerca vencida", () => {
    expect(check(fixture("fences-have-owner-and-review-date"), "2026-06-01")).toEqual({
      malformed: [
        "fences/no-header.test.ts: cabeçalho sem `dono:`",
        "fences/no-header.test.ts: cabeçalho sem `motivo:`",
        "fences/no-header.test.ts: cabeçalho sem `revisar em: AAAA-MM-DD`",
      ],
      expired: ["fences/expired.test.ts: revisão venceu em 2026-01-01"],
    });
  });
});
