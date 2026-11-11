// dono: @DeskLabs-OpenSource/maintainers
// motivo: workflow sem `permissions` herda o padrão do repositório, que pode ser escrita em tudo;
//   um passo comprometido (ou um PR malicioso) passa a poder publicar imagem e empurrar código.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, asRecord, expectClean, fixture, loadWorkflows } from "./_lib";

function check(root: string): string[] {
  const violations: string[] = [];
  for (const { file, doc } of loadWorkflows(root)) {
    if (!("permissions" in doc)) {
      violations.push(`${file}: sem \`permissions\` no topo`);
      continue;
    }
    if (typeof doc.permissions === "string") {
      violations.push(`${file}: \`permissions: ${doc.permissions}\` no topo; declare escopo por escopo`);
      continue;
    }
    for (const [scope, level] of Object.entries(asRecord(doc.permissions))) {
      if (scope !== "contents" || level !== "read") {
        violations.push(`${file}: \`${scope}: ${String(level)}\` no topo; o topo só aceita \`contents: read\` ou \`{}\``);
      }
    }
  }
  return violations;
}

describe("workflows-declare-permissions", () => {
  it("todo workflow declara permissões mínimas no topo", () => {
    expectClean(
      check(REPO_ROOT),
      "Ponha `permissions:\\n  contents: read` (ou `permissions: {}`) no topo do workflow e declare a escrita só no job que precisa dela (`jobs.<job>.permissions`).",
    );
  });

  it("reprova workflow sem permissions, com escrita no topo e com write-all", () => {
    expect(check(fixture("workflows-declare-permissions"))).toEqual([
      ".github/workflows/missing.yml: sem `permissions` no topo",
      ".github/workflows/write-all.yml: `permissions: write-all` no topo; declare escopo por escopo",
      ".github/workflows/write-on-top.yml: `packages: write` no topo; o topo só aceita `contents: read` ou `{}`",
    ]);
  });
});
