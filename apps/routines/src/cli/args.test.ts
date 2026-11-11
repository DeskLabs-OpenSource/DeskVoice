import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { cliArgs } from "./args";

const options = { email: { type: "string" }, "password-stdin": { type: "boolean" } } as const;

describe("cliArgs", () => {
  it("remove o `--` que o pnpm repassa antes das opções", () => {
    expect(cliArgs(["--", "--email", "a@b.co", "--password-stdin"])).toEqual(["--email", "a@b.co", "--password-stdin"]);
  });

  it("não mexe em argumentos chamados direto, sem o `--`", () => {
    expect(cliArgs(["--email", "a@b.co"])).toEqual(["--email", "a@b.co"]);
  });

  it("só remove o `--` da frente: um no meio continua encerrando as opções", () => {
    expect(cliArgs(["--email", "a@b.co", "--", "resto"])).toEqual(["--email", "a@b.co", "--", "resto"]);
  });

  it("deixa o parseArgs ler as opções na forma que o instalador usa", () => {
    const { values } = parseArgs({ args: cliArgs(["--", "--email", "a@b.co", "--password-stdin"]), options });
    expect(values).toEqual({ email: "a@b.co", "password-stdin": true });
  });

  it("sem o conserto, a mesma chamada é recusada (o defeito que isto fecha)", () => {
    expect(() => parseArgs({ args: ["--", "--email", "a@b.co", "--password-stdin"], options })).toThrow(/positional/);
  });
});
