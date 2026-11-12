import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de tela: dirigem o Chromium contra um painel que já está no ar. Não sobem nada sozinhos.
 * No CI rodam no job `install`, depois da instalação de verdade; na sua máquina, contra o painel
 * que você subiu (o passo a passo está na skill `deskvoice-contribuir`).
 *
 * - `DESKVOICE_E2E_URL`: endereço do painel (padrão: a porta local que o instalador escolhe sem domínio).
 * - `DESKVOICE_E2E_EMAIL` e `DESKVOICE_E2E_PASSWORD`: o dono. Sempre por variável, nunca no arquivo.
 */
export default defineConfig({
  testDir: ".",
  // Rastros e capturas em `test-results/`, relatório em `playwright-report/`: nomes que as cercas
  // e o `.gitignore` já tratam como saída gerada.
  outputDir: "test-results",
  // Um painel, um banco: em série, cada teste vê só o que ele mesmo fez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Uma nova tentativa no CI, onde o navegador divide o runner com a instalação inteira. O que só
  // passa na segunda sai marcado como "flaky" no relatório: é aviso, e não silêncio.
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.DESKVOICE_E2E_URL ?? "http://127.0.0.1:3080",
    // O painel escolhe o idioma pelo navegador; os textos esperados vêm do dicionário pt-BR.
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
