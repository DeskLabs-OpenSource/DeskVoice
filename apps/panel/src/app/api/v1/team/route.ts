import { handle } from "../../../../server/context";

// Nunca sai daqui resumo de senha nem de convite: as colunas são nomeadas uma a uma.
export const GET = handle({ configure: true }, async ({ q, session, deps }) => ({
  people: await q.many(
    `select id, name, email::text as email, role, disabled_at is null as active, phone_e164 as phone, whatsapp_e164 as whatsapp, id = $1 as "isYou"
       from users order by disabled_at is not null, created_at`,
    [session.userId],
  ),
  invites: await q.many(
    `select i.id, i.email::text as email, i.name, i.role, i.expires_at as "expiresAt", u.name as "createdByName"
       from invites i left join users u on u.id = i.created_by
      where i.accepted_at is null and i.revoked_at is null and i.expires_at > $1 order by i.created_at desc`,
    [deps.clock.now()],
  ),
}));
