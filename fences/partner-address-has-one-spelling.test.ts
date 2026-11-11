// dono: @DeskLabs-OpenSource/maintainers
// motivo: o link de parceria estava escrito à mão em sete arquivos e faltava justamente no que o
//   assistente de instalação carrega; endereço copiado diverge, e link trocado não apoia o projeto.
// revisar em: 2027-05-11
import { describe, it, expect } from "vitest";
import { REPO_ROOT, exists, expectClean, fixture, listFiles, read } from "./_lib";

const DATA_FILE = "install/partner.env";
// Por onde um assistente entra: o endereço precisa estar escrito ali, e não só no README.
const MUST_CARRY = ["AGENTS.md", ".agents/skills/deskvoice-instalar/SKILL.md"];
const isText = (file: string): boolean => !/\.(png|jpe?g|gif|ico|webp|woff2?|ulaw|wav|gz|zip|pdf)$/i.test(file);

function check(root: string): string[] {
  if (!exists(root, DATA_FILE)) return [`${DATA_FILE}: não existe`];
  const url = /^PARTNER_URL="(https:\/\/[^"\s]+)"$/m.exec(read(root, DATA_FILE))?.[1];
  if (!url) return [`${DATA_FILE}: sem uma linha PARTNER_URL="https://..."`];
  const domain = new URL(url).hostname.replace(/^www\./, "");
  // Todo trecho contínuo que contém o domínio, com o que vem grudado antes e depois.
  const mention = new RegExp(`[\\w.:/+-]*${domain.replace(/\./g, "\\.")}[^\\s<>()"'\`\\]|*]*`, "gi");
  const violations: string[] = [];
  for (const file of listFiles(root, ".", isText)) {
    const text = read(root, file);
    for (const match of text.matchAll(mention)) {
      const found = match[0].replace(/[.,;:!?]+$/, "");
      if (found !== url) violations.push(`${file}: \`${found}\` não é o endereço de ${DATA_FILE}`);
    }
  }
  for (const file of MUST_CARRY) {
    if (!exists(root, file) || !read(root, file).includes(url)) violations.push(`${file}: não traz o endereço de ${DATA_FILE}`);
  }
  return violations;
}

describe("partner-address-has-one-spelling", () => {
  it("todo endereço do domínio da parceira é exatamente o de install/partner.env", () => {
    expectClean(
      check(REPO_ROOT),
      "Escreva o endereço exatamente como está em PARTNER_URL, em install/partner.env, sem parâmetro a mais e sem outro caminho. Em script, leia de lá (`partner_value PARTNER_URL`). Para trocar o endereço, mude install/partner.env e todos os documentos na mesma mudança.",
    );
  });

  it("reprova outro caminho, parâmetro a mais, domínio solto e documento de entrada sem o endereço", () => {
    expect(check(fixture("partner-address-has-one-spelling"))).toEqual([
      "AGENTS.md: `https://www.parceiro.example/outro-caminho.html` não é o endereço de install/partner.env",
      "README.md: `https://www.parceiro.example/vps-1.html?ref=2` não é o endereço de install/partner.env",
      "README.md: `parceiro.example` não é o endereço de install/partner.env",
      "AGENTS.md: não traz o endereço de install/partner.env",
      ".agents/skills/deskvoice-instalar/SKILL.md: não traz o endereço de install/partner.env",
    ]);
  });

  it("reprova o arquivo de dados ausente", () => {
    expect(check(fixture("docs-point-to-existing-files"))).toEqual(["install/partner.env: não existe"]);
  });
});
