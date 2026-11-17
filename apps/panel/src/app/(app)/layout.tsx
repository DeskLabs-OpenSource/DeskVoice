import { accountOfMember, adminsExplicit, isInstallationAdmin } from "@deskvoice/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { THEME_COOKIE } from "../../i18n/locales";
import { SESSION_COOKIE, findSession, serverDeps, suspendedOrganization } from "../../server/context";
import { LiveProvider } from "../../ui/live";
import { Shell } from "../../ui/shell";
import { SuspendedShell } from "../../ui/suspended";

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
  const me = { name: session.name, email: session.email, role: session.role, installationAdmin, installationExplicit };
  // Organização suspensa: o nome, o motivo e mais nada; quem administra a instalação ainda chega lá (seção 3.3).
  const suspended = await suspendedOrganization(deps, session);
  if (suspended) {
    return (
      <SuspendedShell me={me} organization={suspended}>
        {children}
      </SuspendedShell>
    );
  }
  return (
    <LiveProvider>
      <Shell me={me} theme={theme === "light" || theme === "dark" ? theme : undefined}>
        {children}
      </Shell>
    </LiveProvider>
  );
}
