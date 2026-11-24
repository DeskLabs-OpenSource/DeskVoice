// A peça simulada do pipeline (a transcrição e a voz de teste) só é aceita na escolha do agente por
// configuração de teste (`ServerDeps.simulatedPieces`, fatia 5b-2 do pipeline). Nenhuma variável de
// ambiente a liga num servidor instalado: o painel montado pelo ambiente sai sem ela, e nenhum código fora
// dos testes a escreve.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serverDeps, setServerDeps } from "./context";

const ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Um ambiente de produção válido, mais as variáveis que alguém poderia achar que ligam o simulado. */
const PRODUCTION_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://deskvoice_app:senha@127.0.0.1:1/nada",
  SYSTEM_DATABASE_URL: "postgres://deskvoice_system:senha@127.0.0.1:1/nada",
  DESKVOICE_SECRET_KEY: "11".repeat(32),
  PUBLIC_URL: "https://painel.exemplo.test",
  ARI_PASSWORD: "senha-do-ari",
  INTERNAL_TOKEN: "token-interno",
  NODE_ENV: "test",
  CI: "true",
  VITEST: "true",
  SIMULATED_PIECES: "true",
  DESKVOICE_SIMULATED_PIECES: "1",
  PIPELINE_SIMULATED: "1",
};

const saved = { ...process.env };
afterEach(async () => {
  const deps = (globalThis as { __deskvoicePanelDeps?: ReturnType<typeof serverDeps> }).__deskvoicePanelDeps;
  setServerDeps(undefined);
  await deps?.db.close();
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

/** Os arquivos de código de `apps/*\/src` e `packages/*\/src`, sem os de teste. */
async function sources(): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "testing" || entry.name === ".next") continue;
        await walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
    }
  }
  for (const group of ["apps", "packages"]) {
    for (const entry of await readdir(path.join(ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = path.join(ROOT, group, entry.name, "src");
      if (await readdir(src).catch(() => null)) await walk(src);
    }
  }
  return found;
}

describe("a peça simulada do pipeline só por configuração de teste", () => {
  it("o painel montado pelo ambiente de produção sai sem `simulatedPieces`, mesmo com variáveis de teste e de CI", () => {
    Object.assign(process.env, PRODUCTION_ENV);
    setServerDeps(undefined);
    const deps = serverDeps();
    expect(deps.publicUrl).toBe(PRODUCTION_ENV.PUBLIC_URL);
    expect(deps.simulatedPieces).toBeUndefined();
    expect("simulatedPieces" in deps).toBe(false);
  });

  it("fora dos testes, `simulatedPieces` só aparece na declaração e na leitura de `requirePipeline`", async () => {
    const uses: string[] = [];
    for (const file of await sources()) {
      const lines = (await readFile(file, "utf8")).split("\n");
      for (const line of lines) {
        const code = line.trim();
        if (!code.includes("simulatedPieces") || code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
        uses.push(`${path.relative(ROOT, file)}: ${code}`);
      }
    }
    expect(uses.sort()).toEqual([
      "apps/panel/src/server/context.ts: simulatedPieces?: boolean;",
      'apps/panel/src/server/pipeline.ts: export async function requirePipeline(q: OrgQuery, deps: Pick<ServerDeps, "simulatedPieces">, choice: PipelineChoice | null | undefined): Promise<void> {',
      "apps/panel/src/server/pipeline.ts: if (id === SIMULATED && deps.simulatedPieces !== true)",
    ]);
  });
});
