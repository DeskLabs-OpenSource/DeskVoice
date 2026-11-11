// dono: @DeskLabs-OpenSource/maintainers
// motivo: a skill é editada em `.agents/skills` e o Claude Code lê `.claude/skills`. Espelho velho
//   ensina a regra antiga a metade dos assistentes; skill que nenhum índice cita ninguém carrega.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { listSkills, mirrorDifferences } from "../scripts/sync-skills";
import { REPO_ROOT, exists, expectClean, fixture, read } from "./_lib";

/** Onde cada skill precisa ser citada para algum assistente descobri-la. */
const INDEXES = ["AGENTS.md", ".cursor/rules/deskvoice-guias.mdc", ".agents/rules/deskvoice-guias.md"];

function check(root: string): string[] {
  const violations = mirrorDifferences(root);
  for (const index of INDEXES.filter((file) => exists(root, file))) {
    const text = read(root, index);
    for (const skill of listSkills(root)) {
      if (!text.includes(skill)) violations.push(`${index}: não cita a skill ${skill}`);
    }
  }
  return violations;
}

describe("skills-mirror-is-in-sync", () => {
  it("o espelho .claude/skills é fiel à fonte e os índices citam cada skill", () => {
    expectClean(
      check(REPO_ROOT),
      "Edite sempre a fonte em `.agents/skills/` e rode `pnpm skills:sync`. Skill nova também ganha uma linha na tabela \"situação → skill\" do AGENTS.md, de `.cursor/rules/deskvoice-guias.mdc` e de `.agents/rules/deskvoice-guias.md`.",
    );
  });

  it("reprova espelho divergente, arquivo faltando, sobra no espelho e skill sem citação", () => {
    expect(check(fixture("skills-mirror-is-in-sync")).sort()).toEqual([
      ".claude/skills/deskvoice-demo/SKILL.md: difere da fonte",
      ".claude/skills/deskvoice-demo/references/extra.md: faltando no espelho",
      ".claude/skills/deskvoice-demo/stale.md: sobra no espelho (não existe na fonte)",
      ".claude/skills/deskvoice-gone: skill no espelho sem fonte em .agents/skills",
      "AGENTS.md: não cita a skill deskvoice-demo",
    ]);
  });
});
