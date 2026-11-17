import { adminsExplicit } from "@deskvoice/core";
import { redirect } from "next/navigation";
import { serverDeps } from "../../../../server/context";
import { UpdatePanel } from "../update-panel";

/**
 * A tela de atualizar. Depois que a lista de quem administra a instalação fica explícita, ela mora
 * na área da instalação (seção 3.11 do desenho do R8); antes disso, fica aqui, como sempre esteve.
 */
export default async function SystemSettings() {
  if (await adminsExplicit(serverDeps().db)) redirect("/installation/update");
  return <UpdatePanel />;
}
