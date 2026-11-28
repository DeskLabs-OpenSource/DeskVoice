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

type OrganizationLimits = { maxTrunks: number | null; maxAgents: number | null; monthlySpendCapCents: number | null; outboundAllowed: boolean };

/**
 * Tira a trava da saída da organização em que a sessão está, se ela tiver uma, pela área da instalação,
 * como quem instalou faria (Administrar a instalação, Organizações, Limites). A organização criada pelo
 * instalador nasce com a trava (convenção 14). Devolve a função que põe a trava de volta como estava.
 */
export async function unlockOutbound(page: Page): Promise<() => Promise<void>> {
  const policy = (await (await page.request.get("/api/v1/outbound-policy")).json()) as { data: { lockedByInstallation: boolean } };
  if (!policy.data.lockedByInstallation) return async () => {};
  const list = (await (await page.request.get("/api/v1/installation/organizations")).json()) as { data: { organizations: { id: string; current: boolean }[] } };
  const current = list.data.organizations.find((organization) => organization.current);
  if (!current) throw new Error("the session's organization is not in the installation list: the e2e owner must administer the installation");
  const path = `/api/v1/installation/organizations/${current.id}/limits`;
  const { maxTrunks, maxAgents, monthlySpendCapCents } = ((await (await page.request.get(path)).json()) as { data: OrganizationLimits }).data;
  const put = async (outboundAllowed: boolean) => expect((await page.request.put(path, { data: { maxTrunks, maxAgents, monthlySpendCapCents, outboundAllowed } })).status()).toBe(200);
  await put(true);
  return () => put(false);
}
