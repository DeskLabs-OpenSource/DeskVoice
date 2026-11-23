/**
 * Consultas que leem `users` sem filtrar `kind = 'member'`, fora de `packages/core/src/accounts.ts`.
 *
 * O vínculo de suporte da instalação (`kind = 'support'`, R8 seção 3.6) mora em `users` junto com a
 * equipe. Toda consulta que escolhe, conta, lista ou avisa pessoas filtra `kind = 'member'`. As daqui
 * não escolhem ninguém: mostram o nome de quem já agiu, leem a própria sessão ou acham o vínculo pelo
 * `id` que outra consulta já conferiu. Cada uma tem o motivo em uma linha.
 *
 * `query` é um trecho do texto da consulta (espaços contam como um só). A exceção vale só para a
 * consulta que contém o trecho, no arquivo dado: a consulta nova no mesmo arquivo passa pela cerca.
 */
export interface PeopleQueryException {
  file: string;
  query: string;
  reason: string;
}

export const PEOPLE_QUERIES_ALLOWLIST: PeopleQueryException[] = [
  { file: "apps/panel/src/app/api/v1/analysts/store.ts", query: "(select u.name from users u where u.id = provider_confirmed_by)", reason: "mostra o nome de quem confirmou o provedor" },
  { file: "apps/panel/src/app/api/v1/approvals/route.ts", query: "left join users u on u.id = p.decided_by", reason: "mostra o nome de quem decidiu a aprovação" },
  { file: "apps/panel/src/app/api/v1/auth/me/route.ts", query: "from users u join organizations o on o.id = u.organization_id", reason: "a própria pessoa da sessão, pelo id da sessão" },
  { file: "apps/panel/src/app/api/v1/auth/me/route.ts", query: "select ${COLUMNS} from users where id = $1", reason: "a própria pessoa da sessão, pelo id da sessão" },
  { file: "apps/panel/src/app/api/v1/follow-ups/route.ts", query: "select id, name from users where id in (", reason: "mostra o nome de quem os eventos da pendência citam" },
  { file: "apps/panel/src/app/api/v1/privacy/route.ts", query: "left join users u on u.id = e.actor_user_id", reason: "mostra o nome de quem agiu no evento de privacidade" },
  { file: "apps/panel/src/app/api/v1/team/invites/route.ts", query: "select 1 from users where email = $1", reason: "recusa convite para e-mail que já tem vínculo; o caso do suporte é da fatia 5c" },
  { file: "apps/panel/src/app/api/v1/team/route.ts", query: "left join users u on u.id = i.created_by", reason: "mostra o nome de quem criou o convite" },
  { file: "apps/panel/src/app/api/v1/team/users/[id]/route.ts", query: "delete from users where id = $1", reason: "remove pelo id que `loadMember` já achou entre os `member`" },
  { file: "apps/panel/src/app/api/v1/team/users/[id]/route.ts", query: "select account_id as \"accountId\" from users where id = $1", reason: "a conta de quem faz o pedido, pelo id da sessão" },
  { file: "apps/panel/src/app/api/v1/whatsapp/test/route.ts", query: "select whatsapp_e164 as whatsapp from users where id = $1", reason: "o WhatsApp da própria pessoa da sessão, para a mensagem de teste" },
  { file: "apps/panel/src/server/context.ts", query: "insert into sessions", reason: "cria a sessão do vínculo que o login já escolheu" },
  { file: "apps/panel/src/server/follow-ups.ts", query: "left join users o on o.id = f.owner_user_id left join users c on c.id = f.closed_by", reason: "mostra o nome do responsável e de quem fechou" },
  { file: "apps/panel/src/server/synthesizers.ts", query: "select u.name from users u where u.id::text = $1", reason: "mostra o nome de quem deu o consentimento" },
  { file: "packages/core/src/caller-history.ts", query: "left join users u on u.id = f.owner_user_id", reason: "mostra o nome do responsável da pendência aberta" },
  { file: "packages/core/src/installation.ts", query: "select distinct account_id as id from users where organization_id = $1", reason: "a exclusão de organização: toda conta com vínculo ali, de qualquer `kind`, é candidata a ficar sem vínculo" },
  { file: "packages/core/src/installation.ts", query: "not exists (select from users u where u.account_id = a.id)", reason: "a conta órfã da exclusão: qualquer vínculo, de qualquer `kind`, segura a conta, como em `deleteOrphanAccount`" },
  { file: "packages/core/src/installation.ts", query: "(select account_id from users where id = $2)", reason: "a conta do vínculo que a mesma consulta já filtrou como `member`" },
  { file: "packages/core/src/invites.ts", query: "exists (select from users u where u.account_id =", reason: "a conta tem algum vínculo, de qualquer `kind`, de propósito" },
  { file: "packages/core/src/invites.ts", query: "select 1 from users where organization_id = $1 and account_id = $2", reason: "um vínculo por conta e organização (`users_one_membership_idx`); o caso do suporte é da 5c" },
  { file: "packages/core/src/support-access.ts", query: "select id, kind from users where organization_id = $1 and account_id = $2", reason: "o vínculo da conta na organização, de qualquer `kind`: recusa o `member` e reativa o `support`" },
  { file: "packages/core/src/share-links.ts", query: "left join users u on u.id = s.created_by", reason: "mostra o nome de quem criou o link" },
];
