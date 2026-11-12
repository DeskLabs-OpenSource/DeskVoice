import { z } from "zod";
import { handle } from "../../../../../server/context";
import { sendTest } from "../../../../../server/whatsapp";
import { LOCALES } from "../../../../../i18n/locales";

// `locale` é o idioma da tela de quem clicou: só escolhe entre os três textos fixos do servidor.
export const POST = handle(
  { body: z.object({ locale: z.enum(LOCALES).default("pt-BR") }), configure: true, after: (to: string | null, { deps, session, body }) => sendTest(deps, session, to, body.locale) },
  async ({ q, session }) => {
    const user = await q.one<{ whatsapp: string | null }>("select whatsapp_e164 as whatsapp from users where id = $1", [session.userId]);
    return user?.whatsapp ?? null;
  },
);
