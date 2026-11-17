-- O e-mail do vínculo passa a ser único por organização, e não mais na instalação (R8, fatia 3).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, seção 3.1:
-- "`users.email` deixa de ser único na instalação e passa a ser único por organização".
--
-- A fatia 1 criou `accounts.email` único e ligou cada vínculo à conta, mas o `unique` de
-- `users.email` da fundação ficou. Com ele, a mesma conta não consegue ter vínculo em duas
-- organizações, que é o que esta fatia entrega.
--
-- `users.email` continua sendo a cópia de `accounts.email` para a tela da equipe, gravada só por
-- `addMembership` (`packages/core/src/accounts.ts`). Uma conta tem no máximo um vínculo por
-- organização (`users_one_membership_idx`), então o par organização e e-mail já é único; o índice
-- abaixo deixa isso escrito para quem procura uma pessoa da equipe pelo e-mail.

alter table users drop constraint users_email_key;
create unique index users_email_per_organization_idx on users (organization_id, email);
