import { accountOfMember, isInstallationAdmin } from "@deskvoice/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, findSession, serverDeps } from "../../../../server/context";

/**
 * O endereço antigo da tela de atualizar (central de configuração, parte 8). A tela mora só na área
 * da instalação: quem a administra vai para lá, e quem não administra (ou está sem sessão) volta à
 * central de Configurações. A conferência é a mesma do layout da área, para os dois lados nunca
 * discordarem e um mandar ao outro.
 */
export default async function SystemSettings() {
  const deps = serverDeps();
  const session = await findSession(deps, (await cookies()).get(SESSION_COOKIE)?.value);
  const accountId = session ? await accountOfMember(deps.db, session.userId) : null;
  redirect(accountId && (await isInstallationAdmin(deps.db, accountId)) ? "/installation/update" : "/settings");
}
