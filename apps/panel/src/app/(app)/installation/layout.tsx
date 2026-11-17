import { accountOfMember, isInstallationAdmin } from "@deskvoice/core";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SESSION_COOKIE, findSession, serverDeps } from "../../../server/context";
import { InstallationNav } from "./nav";

/**
 * A área da instalação (seção 5, fatia 2, do desenho do R8). Quem não administra a instalação não
 * vê a porta no menu e, se digitar o endereço, recebe "não encontrado": a página não diz que existe.
 * As rotas da API conferem de novo, com 403.
 */
export default async function InstallationLayout({ children }: { children: ReactNode }) {
  const deps = serverDeps();
  const session = await findSession(deps, (await cookies()).get(SESSION_COOKIE)?.value);
  const accountId = session ? await accountOfMember(deps.db, session.userId) : null;
  if (!accountId || !(await isInstallationAdmin(deps.db, accountId))) notFound();
  return (
    <>
      <InstallationNav />
      {children}
    </>
  );
}
