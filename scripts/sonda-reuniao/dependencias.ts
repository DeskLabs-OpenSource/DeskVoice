/**
 * O Playwright da sonda vem do painel (`apps/panel`, `@playwright/test`), que já o usa nos testes
 * de tela. Assim nenhuma dependência nova entra no `package.json` da raiz e o lockfile não muda,
 * como na bancada de voz (`scripts/bancada-de-voz/dependencias.ts`).
 */
import { createRequire } from "node:module";
// Os tipos vêm pelo caminho que o pnpm deixa na raiz: pelo link do painel, o TypeScript não acha o
// `playwright/test` que o `@playwright/test` reexporta.
import type * as Playwright from "../../node_modules/.pnpm/node_modules/@playwright/test";

const doPainel = createRequire(new URL("../../apps/panel/package.json", import.meta.url));

/** Carregado só quando a sonda roda: os testes de unidade não abrem navegador. */
export const loadPlaywright = (): typeof Playwright => doPainel("@playwright/test") as typeof Playwright;
export type Page = Playwright.Page;
