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
  return (
    <LiveProvider>
      <Shell me={{ name: session.name, email: session.email, role: session.role }} theme={theme === "light" || theme === "dark" ? theme : undefined}>
        {children}
      </Shell>
    </LiveProvider>
  );
}
