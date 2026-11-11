import { describe, expect, it } from "vitest";
import { applyToChangelog, assembleSection, extractSection, latestVersion } from "./assemble";
import type { Fragment } from "./fragment";

const fragment = (overrides: Partial<Fragment>): Fragment => ({
  file: "a.md",
  impact: "nothing_changes",
  section: "fixed",
  title: "Título",
  body: "Corpo. Crédito: @maria.",
  attention: null,
  ...overrides,
});

describe("assembleSection", () => {
  it("põe o aviso primeiro e as seções na ordem adicionado, alterado, corrigido", () => {
    const section = assembleSection(
      [
        fragment({ file: "c.md", title: "Conserto" }),
        fragment({ file: "b.md", section: "changed", impact: "operator_action", title: "Porta nova", body: "Mudou.\nCrédito: @joao.", attention: "Libere a 9093.\nDepois reinicie." }),
        fragment({ file: "a.md", section: "added", impact: "new_capability", title: "Transferência" }),
      ],
      "0.2.0",
      "2026-11-10",
    );
    expect(section).toBe(
      [
        "## [0.2.0] - 2026-11-10",
        "### Requer atenção",
        "- **Porta nova** Libere a 9093.\n  Depois reinicie.",
        "### Adicionado",
        "- **Transferência** Corpo. Crédito: @maria.",
        "### Alterado",
        "- **Porta nova** Mudou.\n  Crédito: @joao.",
        "### Corrigido",
        "- **Conserto** Corpo. Crédito: @maria.",
      ].join("\n\n"),
    );
  });

  it("omite seção vazia e o aviso quando ninguém pede ação", () => {
    const section = assembleSection([fragment({})], "0.1.1", "2026-11-10");
    expect(section).toBe("## [0.1.1] - 2026-11-10\n\n### Corrigido\n\n- **Título** Corpo. Crédito: @maria.");
  });

  it("recusa montar seção sem fragmento", () => {
    expect(() => assembleSection([], "0.1.0", "2026-11-10")).toThrow(/nenhum fragmento/);
  });
});

describe("applyToChangelog", () => {
  const section = "## [0.2.0] - 2026-11-10\n\n### Corrigido\n\n- **T** C.";

  it("cria o arquivo na primeira versão", () => {
    const changelog = applyToChangelog("", section);
    expect(changelog.startsWith("# Changelog\n")).toBe(true);
    expect(changelog.endsWith(`${section}\n`)).toBe(true);
    expect(latestVersion(changelog)).toBe("0.2.0");
  });

  it("insere acima da versão anterior e preserva o cabeçalho", () => {
    const before = "# Changelog\n\nIntrodução.\n\n## [0.1.0] - 2026-10-01\n\n### Adicionado\n\n- **Antiga** X.\n";
    expect(applyToChangelog(before, section)).toBe(`# Changelog\n\nIntrodução.\n\n${section}\n\n## [0.1.0] - 2026-10-01\n\n### Adicionado\n\n- **Antiga** X.\n`);
  });

  it("não interpreta `$&` do texto como padrão de substituição", () => {
    expect(applyToChangelog("# Changelog\n", "## [0.1.0] - 2026-11-10\n\n- **T** custa $& e $1.")).toContain("custa $& e $1.");
  });
});

describe("latestVersion e extractSection", () => {
  const changelog = "# Changelog\n\n## [0.2.0] - 2026-11-10\n\n### Corrigido\n\n- **Nova** N.\n\n## [0.1.0] - 2026-10-01\n\n- **Antiga** X.\n";

  it("acha a versão mais nova, ou null sem versão", () => {
    expect(latestVersion(changelog)).toBe("0.2.0");
    expect(latestVersion("# Changelog\n")).toBeNull();
  });

  it("extrai só o texto da versão pedida", () => {
    expect(extractSection(changelog, "0.2.0")).toBe("### Corrigido\n\n- **Nova** N.");
    expect(extractSection(changelog, "0.1.0")).toBe("- **Antiga** X.");
    expect(extractSection(changelog, "9.9.9")).toBeNull();
  });
});
