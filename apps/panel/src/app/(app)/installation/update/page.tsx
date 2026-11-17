import { adminsExplicit } from "@deskvoice/core";
import { redirect } from "next/navigation";
import { serverDeps } from "../../../../server/context";
import { UpdatePanel } from "../../settings/update-panel";

/** A tela de atualizar, aqui só depois que a lista de quem administra ficou explícita (seção 3.11). Antes, mora nas Configurações. */
export default async function InstallationUpdate() {
  if (!(await adminsExplicit(serverDeps().db))) redirect("/settings/system");
  return <UpdatePanel />;
}
