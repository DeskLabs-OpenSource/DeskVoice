// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm, recurso novo exigia variável de ambiente digitada à mão na VPS e nascia
//   quebrado em toda instalação existente (conectar o tronco pedia editar arquivo por SSH).
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { ENV_ALLOWLIST } from "./env-allowlist";
import { REPO_ROOT, exists, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";

// Heurística: `process.env.X`, `env.X`, `env["X"]`, `const { X } = process.env` e as chaves em
// MAIÚSCULAS do schema de `packages/core/src/config.ts` (é lá que `loadConfig` nomeia o que lê).
// Teto conhecido: acesso dinâmico (`process.env[name]`) não é visto. Testes ficam de fora: variável
// de teste não chega à VPS de ninguém.
const DIRECT = /\benv\s*(?:\?\.|\.|\[\s*["'])([A-Z][A-Z0-9_]+)/g;
const DESTRUCTURED = /\{([^}]*)\}\s*=\s*process\.env\b/g;
const CONFIG_FILE = "packages/core/src/config.ts";
const CONFIG_KEY = /^\s+([A-Z][A-Z0-9_]{2,})\s*:/gm;

function check(root: string, allowlist: Record<string, string>): string[] {
  const violations: string[] = [];
  const report = (file: string, name: string): void => {
    const line = `${file}: lê ${name}, que não está em fences/env-allowlist.ts`;
    if (!(name in allowlist) && !violations.includes(line)) violations.push(line);
  };
  for (const dir of ["packages", "apps"]) {
    for (const file of listFiles(root, dir, (f) => isSource(f) && !isTest(f))) {
      const source = read(root, file);
      for (const match of source.matchAll(DIRECT)) report(file, match[1] ?? "");
      for (const match of source.matchAll(DESTRUCTURED)) {
        for (const part of (match[1] ?? "").split(",")) {
          const name = part.split(/[:=]/)[0]?.trim() ?? "";
          if (/^[A-Z][A-Z0-9_]+$/.test(name)) report(file, name);
        }
      }
    }
  }
  if (exists(root, CONFIG_FILE)) {
    for (const match of read(root, CONFIG_FILE).matchAll(CONFIG_KEY)) report(CONFIG_FILE, match[1] ?? "");
  }
  return violations;
}

describe("env-vars-have-defaults", () => {
  it("toda variável de ambiente lida pelo produto tem padrão ou é gerada pelo instalador", () => {
    expectClean(
      check(REPO_ROOT, ENV_ALLOWLIST),
      "Variável nova não liga recurso: a configuração do operador mora em `settings` e tem tela. Se a variável é mesmo de infraestrutura, dê a ela um padrão em `loadConfig` (ou faça o `install/install.sh` gerá-la) e só então registre em fences/env-allowlist.ts com a marca `default` ou `generated`.",
    );
  });

  it("reprova variável fora da lista em cada forma de leitura", () => {
    expect(check(fixture("env-vars-have-defaults"), { DATABASE_URL: "generated" })).toEqual([
      "apps/voice/src/feature.ts: lê NEW_FEATURE_FLAG, que não está em fences/env-allowlist.ts",
      "apps/voice/src/feature.ts: lê BRACKET_VAR, que não está em fences/env-allowlist.ts",
      "apps/voice/src/feature.ts: lê DESTRUCTURED_VAR, que não está em fences/env-allowlist.ts",
      "packages/core/src/config.ts: lê SCHEMA_ONLY_VAR, que não está em fences/env-allowlist.ts",
    ]);
  });
});
