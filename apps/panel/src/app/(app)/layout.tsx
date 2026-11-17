import { accountOfMember, adminsExplicit, isInstallationAdmin } from "@deskvoice/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { THEME_COOKIE } from "../../i18n/locales";
import { SESSION_COOKIE, findSession, serverDeps } from "../../server/context";
import { LiveProvider } from "../../ui/live";
import { Shell } from "../../ui/shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = await findSession(serverDeps(), jar.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  const theme = jar.get(THEME_COOKIE)?.value;
  // Quem administra a instalação vê a porta da área no bloco da conta; a navegação principal não muda.
  const deps = serverDeps();
  const accountId = await accountOfMember(deps.db, session.userId);
  const installationAdmin = accountId !== null && (await isInstallationAdmin(deps.db, accountId));
  const installationExplicit = await adminsExplicit(deps.db);
  return (
    <LiveProvider>
      <Shell me={{ name: session.name, email: session.email, role: session.role, installationAdmin, installationExplicit }} theme={theme === "light" || theme === "dark" ? theme : undefined}>
        {children}
      </Shell>
    </LiveProvider>
  );
}
