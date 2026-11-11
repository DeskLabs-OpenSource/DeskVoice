// dono: @DeskLabs-OpenSource/maintainers
// motivo: `pull_request_target` roda com o token do repositório de destino. Fazer checkout do código
//   do fork ou chamar action de terceiros ali entrega esse token a código que ninguém revisou
//   (a classe de ataque "pwn request").
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, asRecord, expectClean, fixture, jobs, loadWorkflows, triggers } from "./_lib";

/** Só actions mantidas pelo GitHub, e nunca o checkout (ação local também exige checkout). */
function allowed(uses: string): boolean {
  return /^(actions|github)\//.test(uses) && !uses.startsWith("actions/checkout");
}

function check(root: string): string[] {
  const violations: string[] = [];
  for (const { file, doc } of loadWorkflows(root)) {
    if (!triggers(doc).includes("pull_request_target")) continue;
    for (const [name, job] of jobs(doc)) {
      const steps = Array.isArray(job.steps) ? job.steps.map(asRecord) : [];
      for (const uses of [job.uses, ...steps.map((step) => step.uses)]) {
        if (typeof uses === "string" && !allowed(uses)) violations.push(`${file}: job \`${name}\` usa \`${uses}\``);
      }
    }
  }
  return violations;
}

describe("welcome-does-not-checkout", () => {
  it("workflow de pull_request_target não baixa código nem chama action de terceiros", () => {
    expectClean(
      check(REPO_ROOT),
      "Workflow com `pull_request_target` só comenta ou etiqueta, com `gh api` num passo `run`. Se precisa do código do PR, o lugar é o ci.yml (`pull_request`), que roda sem segredo e sem escrita.",
    );
  });

  it("reprova checkout, action de terceiros e action local", () => {
    expect(check(fixture("welcome-does-not-checkout"))).toEqual([
      ".github/workflows/welcome.yml: job `greet` usa `actions/checkout@v4`",
      ".github/workflows/welcome.yml: job `greet` usa `someone/comment-action@v1`",
      ".github/workflows/welcome.yml: job `greet` usa `./.github/actions/setup`",
    ]);
  });
});
