import { handle } from "../../../../server/context";

// O aviso de uma pendência tem corpo fixo; o título vem da própria pendência, pelo id. Pendência
// apagada pelo prazo leva o aviso junto (cascata), então nunca há aviso apontando para o nada.
export const GET = handle({}, ({ q }) =>
  q.many(
    `select n.id, n.call_id as "callId", n.body, n.created_at as "createdAt", n.read_at as "readAt",
            n.follow_up_id as "followUpId", f.title as "followUpTitle", f.status as "followUpStatus"
       from notifications n left join follow_ups f on f.id = n.follow_up_id
      where n.channel = 'panel' order by (n.read_at is null) desc, n.created_at desc limit 50`,
  ),
);
