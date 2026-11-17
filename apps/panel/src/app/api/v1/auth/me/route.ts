import type { OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { handle, notFound, type Session } from "../../../../../server/context";
import { optionalPhone } from "../../../../../server/shapes";

const COLUMNS = `name, email, role, phone_e164 as phone, whatsapp_e164 as whatsapp`;

// O nome da organização vai junto: a tela do agente o mostra no texto padrão da mensagem para quem ligou.
async function me(q: OrgQuery, session: Session) {
  const row = await q.one(
    `select u.name, u.email, u.role, u.phone_e164 as phone, u.whatsapp_e164 as whatsapp, o.name as "organizationName"
       from users u join organizations o on o.id = u.organization_id
      where u.id = $1`,
    [session.userId],
  );
  if (!row) throw notFound();
  return row;
}

export const GET = handle({}, ({ q, session }) => me(q, session));

const body = z.object({ name: z.string().trim().min(1).max(120).optional(), phone: optionalPhone.optional(), whatsapp: optionalPhone.optional() });

// Cada pessoa edita o próprio contato, em qualquer papel: é para onde vão os avisos e os pedidos
// de aprovação fora do painel. Campo ausente fica como está; vazio apaga.
export const PATCH = handle({ body }, async ({ q, session, body }) => {
  const current = await q.one<{ name: string; phone: string | null; whatsapp: string | null }>(`select ${COLUMNS} from users where id = $1`, [session.userId]);
  if (!current) throw notFound();
  await q.exec("update users set name = $2, phone_e164 = $3, whatsapp_e164 = $4 where id = $1", [
    session.userId,
    body.name ?? current.name,
    body.phone === undefined ? current.phone : body.phone,
    body.whatsapp === undefined ? current.whatsapp : body.whatsapp,
  ]);
  return me(q, session);
});
