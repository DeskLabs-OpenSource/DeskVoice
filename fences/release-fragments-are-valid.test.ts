// dono: @DeskLabs-OpenSource/maintainers
// motivo: o texto do fragmento vira a nota que o dono da VPS lê antes de atualizar. No Deskcomm
//   fragmento malformado só era descoberto na hora de cortar a versão, com o autor já longe.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { parseFragment } from "../scripts/release/fragment";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of listFiles(root, ".changes", (f) => f !== ".changes/README.md")) {
    try {
      if (!file.endsWith(".md")) throw new Error("só fragmentos `.md` moram em .changes/");
      parseFragment(file, read(root, file));
    } catch (error) {
      violations.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return violations;
}

describe("release-fragments-are-valid", () => {
  it("todo fragmento em .changes/ é válido", () => {
    expectClean(check(REPO_ROOT), "O formato está em `.changes/README.md`; `pnpm release:check` mostra o mesmo erro e a versão que sairia.");
  });

  it("reprova impacto desconhecido e ação do operador sem instrução", () => {
    expect(check(fixture("release-fragments-are-valid"))).toEqual([
      ".changes/action-without-block.md: `impact: operator_action` sem bloco `## Requer atenção`: o operador precisa saber o que fazer",
      ".changes/unknown-impact.md: `impact` é `minor`; use nothing_changes, new_capability ou operator_action",
    ]);
  });
});
