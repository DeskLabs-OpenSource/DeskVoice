// Os testes do servidor do Laya (deploy/laya/test_server.py) rodam dentro do `pnpm test`: o servidor
// é Python, e sem isto nenhum job do CI o exercitaria (o job `images` não constrói deploy/laya/).
// Não precisam de torch, de Docker nem de rede: o modelo é trocado por um falso.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LAYA_DIR = fileURLToPath(new URL("../deploy/laya", import.meta.url));

describe("o servidor do Laya (deploy/laya/server.py)", () => {
  it("passa nos próprios testes, com o modelo falso", () => {
    const run = spawnSync("python3", ["-I", "-B", "-m", "unittest", "discover", "-s", LAYA_DIR, "-p", "test_*.py"], { encoding: "utf8", timeout: 60_000 });
    // Sem python3, falha dizendo isso: o teste não se pula sozinho.
    expect(run.error?.message ?? null).toBeNull();
    expect({ status: run.status, saida: run.status === 0 ? "" : run.stderr }).toEqual({ status: 0, saida: "" });
    expect(run.stderr).toMatch(/Ran \d+ tests/);
  }, 60_000);
});
