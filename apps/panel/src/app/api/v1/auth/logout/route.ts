import { hashToken, signOut } from "@deskvoice/core";
import { Reply, SESSION_COOKIE, handlePublic, readCookie, sessionCookie } from "../../../../../server/context";

/**
 * Sai. Não depende de a sessão ainda valer: apaga a do cookie em qualquer estado e sempre limpa o
 * cookie, mesmo sem cookie ou com token desconhecido. Na sessão de suporte da instalação, sair
 * encerra o acesso na hora (seção 3.6 do desenho do R8), com o fim nas duas auditorias.
 */
export const POST = handlePublic({}, async ({ request, deps }) => {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await signOut(deps.db, hashToken(token), deps.clock.now());
  return new Reply(null, { "set-cookie": sessionCookie("", deps) });
});
