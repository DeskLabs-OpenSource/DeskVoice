import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/** O dono do painel. Sempre por variável: a varredura de segredos do CI reprova senha escrita em arquivo de teste. */
export function owner(): { email: string; password: string } {
  const email = process.env.DESKVOICE_E2E_EMAIL;
  const password = process.env.DESKVOICE_E2E_PASSWORD;
  if (!email || !password) throw new Error("Set DESKVOICE_E2E_EMAIL and DESKVOICE_E2E_PASSWORD to the panel owner's e-mail and password");
  return { email, password };
}

/** Entra pela API, na mesma sessão do navegador. A tela de login tem o teste dela (`sign-in.spec.ts`). */
export async function signIn(page: Page): Promise<void> {
  const response = await page.request.post("/api/v1/auth/login", { data: owner() });
  expect(response.status(), "the owner could not sign in through the API").toBe(200);
}

/** Sufixo para o que o teste cria: nenhum teste depende do que outro deixou no banco. */
export const unique = (): string => randomUUID().slice(0, 8);
