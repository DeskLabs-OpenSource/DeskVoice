import { defineConfig } from "vitest/config";

const sources = ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/voice/src/**/*.test.ts", "apps/routines/src/**/*.test.ts", "apps/panel/src/**/*.test.ts", "scripts/**/*.test.ts"];

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: sources, exclude: ["**/*.db.test.ts", "**/node_modules/**"] } },
      // Testes que precisam de Postgres real. Rodam em série: compartilham um banco descartável.
      { test: { name: "db", include: sources.map((s) => s.replace(".test.ts", ".db.test.ts")), fileParallelism: false, globalSetup: ["scripts/test-db-setup.ts"] } },
      // Cercas: só leem o repositório. Nenhuma depende de banco, rede ou relógio.
      { test: { name: "fences", include: ["fences/**/*.test.ts"] } },
    ],
  },
});
