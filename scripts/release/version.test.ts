import { describe, expect, it } from "vitest";
import type { Fragment } from "./fragment";
import { computeBump, nextVersion, requiresOperatorAction } from "./version";

describe("computeBump", () => {
  it("só conserto é patch", () => {
    expect(computeBump(["nothing_changes", "nothing_changes"])).toBe("patch");
  });

  it("capacidade nova é minor", () => {
    expect(computeBump(["nothing_changes", "new_capability"])).toBe("minor");
  });

  it("ação do operador é minor, nunca major", () => {
    expect(computeBump(["operator_action"])).toBe("minor");
  });

  it("major só por pedido explícito", () => {
    expect(computeBump(["nothing_changes"], true)).toBe("major");
  });

  it("recusa cortar sem fragmento, mesmo com pedido de major", () => {
    expect(() => computeBump([], true)).toThrow(/nenhum fragmento/);
  });
});

describe("nextVersion", () => {
  it.each([
    ["0.0.0", "minor", "0.1.0"],
    ["1.4.2", "patch", "1.4.3"],
    ["1.4.2", "minor", "1.5.0"],
    ["v1.4.2", "major", "2.0.0"],
  ] as const)("%s + %s = %s", (current, bump, expected) => {
    expect(nextVersion(current, bump)).toBe(expected);
  });

  it("recusa versão que não é X.Y.Z", () => {
    expect(() => nextVersion("1.4", "patch")).toThrow(/X\.Y\.Z/);
  });
});

describe("requiresOperatorAction", () => {
  const base: Fragment = { file: "a.md", impact: "new_capability", section: "added", title: "T", body: "B", attention: null };

  it("é um campo separado do número", () => {
    expect(requiresOperatorAction([base])).toBe(false);
    expect(requiresOperatorAction([base, { ...base, impact: "operator_action", attention: "Faça X." }])).toBe(true);
  });
});
