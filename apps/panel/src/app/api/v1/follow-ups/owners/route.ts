import { handle } from "../../../../../server/context";

/** Quem pode ser dono de uma pendência: as pessoas ativas da equipe, só id e nome, para qualquer papel. */
export const GET = handle({}, ({ q }) => q.many("select id, name from users where disabled_at is null order by name"));
