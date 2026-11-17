// dono: @DeskLabs-OpenSource/maintainers
// motivo: o Codex descobre a skill pelo `agents/openai.yaml` dela (nome na tela, frase curta,
//   pedido de exemplo e se pode carregá-la sozinho). Skill nova que nasce sem o arquivo some para
//   quem usa o Codex, e nada mais no repositório avisa.
// revisar em: 2027-05-16
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { listSkills } from "../scripts/sync-skills";
import { REPO_ROOT, asRecord, exists, expectClean, fixture, read } from "./_lib";

const MANIFEST = "agents/openai.yaml";
const TEXT_FIELDS = ["display_name", "short_description", "default_prompt"] as const;

function check(root: string): string[] {
  const violations: string[] = [];
  for (const skill of listSkills(root)) {
    const file = `.agents/skills/${skill}/${MANIFEST}`;
    if (!exists(root, file)) {
      violations.push(`${file}: faltando`);
      continue;
    }
    let doc: Record<string, unknown>;
    try {
      doc = asRecord(parse(read(root, file)));
    } catch (error) {
      violations.push(`${file}: YAML que não lê (${(error as Error).message.split("\n")[0]})`);
      continue;
    }
    const iface = asRecord(doc.interface);
    for (const field of TEXT_FIELDS) {
      const value = iface[field];
      if (typeof value !== "string" || value.trim() === "") violations.push(`${file}: interface.${field} vazio ou ausente`);
    }
    if (asRecord(doc.policy).allow_implicit_invocation !== true) violations.push(`${file}: policy.allow_implicit_invocation precisa ser true`);
  }
  return violations;
}

describe("skills-have-codex-manifest", () => {
  it("toda skill de .agents/skills tem agents/openai.yaml com os quatro campos", () => {
    expectClean(
      check(REPO_ROOT),
      "Toda skill ganha `agents/openai.yaml` (copie o de uma vizinha e reescreva o texto a partir do `description` do SKILL.md, sem prometer o que ela não faz). Depois rode `pnpm skills:sync`.",
    );
  });

  it("reprova skill sem o arquivo, YAML que não lê, campo vazio e invocação implícita desligada", () => {
    // A mensagem do leitor de YAML muda de versão para versão: fica de fora da comparação.
    const violations = check(fixture("skills-have-codex-manifest")).map((v) => v.replace(/ \(.*\)$/, ""));
    expect(violations.sort()).toEqual([
      ".agents/skills/deskvoice-broken/agents/openai.yaml: YAML que não lê",
      ".agents/skills/deskvoice-empty/agents/openai.yaml: interface.short_description vazio ou ausente",
      ".agents/skills/deskvoice-empty/agents/openai.yaml: policy.allow_implicit_invocation precisa ser true",
      ".agents/skills/deskvoice-missing/agents/openai.yaml: faltando",
    ]);
  });
});
