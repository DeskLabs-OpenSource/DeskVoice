// dono: @DeskLabs-OpenSource/maintainers
// motivo: no corte da 0.12.0, o publish-image escreveu `${matrix.arch}` dentro de um `run:`. É a
//   sintaxe de expressão do workflow sem as chaves duplas, que o bash recusa com "bad substitution",
//   e as duas arquiteturas pararam depois de construir, deixando a tag sem imagens. O shellcheck só
//   chama isso de variável não atribuída (SC2154), e o actionlint desliga esse aviso: nenhum dos
//   dois reprova.
// revisar em: 2027-05-15
import { describe, it, expect } from "vitest";
import { REPO_ROOT, asRecord, expectClean, fixture, jobs, loadWorkflows } from "./_lib";

const CONTEXT = /\$\{(matrix|steps|needs|inputs|github|env|runner|secrets|vars|job|strategy)\.[^}]*\}/g;

function check(root: string): string[] {
  const violations: string[] = [];
  for (const { file, doc } of loadWorkflows(root)) {
    for (const [jobId, job] of jobs(doc)) {
      const steps = Array.isArray(job.steps) ? job.steps : [];
      steps.forEach((raw, index) => {
        const step = asRecord(raw);
        if (typeof step.run !== "string") return;
        for (const found of step.run.match(CONTEXT) ?? []) {
          violations.push(`${file}: jobs.${jobId}, passo ${index + 1} (${String(step.name ?? "sem nome")}): \`${found}\` no shell`);
        }
      });
    }
  }
  return violations;
}

describe("workflow-shell-has-no-expression-context", () => {
  it("nenhum `run:` usa um contexto do workflow como se fosse variável de shell", () => {
    expectClean(
      check(REPO_ROOT),
      "Passe o valor pelo `env:` do passo (por exemplo `ARCH: ${{ matrix.arch }}`) e use `${ARCH}` no script; dentro do `run:`, `${matrix.arch}` é shell, e o bash para com \"bad substitution\".",
    );
  });

  it("reprova matriz e saída de passo escritas no shell, e aceita a variável e a expressão de chaves duplas", () => {
    expect(check(fixture("workflow-shell-has-no-expression-context"))).toEqual([
      ".github/workflows/bad.yml: jobs.build, passo 1 (matriz no shell): `${matrix.arch}` no shell",
      ".github/workflows/bad.yml: jobs.build, passo 2 (saída de passo no shell): `${steps.image.outputs.repo}` no shell",
    ]);
  });
});
