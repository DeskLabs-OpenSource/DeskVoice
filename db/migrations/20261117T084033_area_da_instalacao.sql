-- A área da instalação (R8, fatia 2).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, seção 3.2.
--
-- O papel de sistema muda o VALOR de uma configuração da instalação, e nunca a chave. Trocar a
-- chave de `installation.admins_explicit_at` faria a lista deixar de ser explícita sem apagar a
-- linha, e devolveria o papel pela regra da fundadora. `delete` já não existia.
revoke update on installation_settings from deskvoice_system;
grant update (value, updated_at) on installation_settings to deskvoice_system;

-- O convite do primeiro dono de uma organização criada pela administração (seção 3.3). Quem convida
-- não tem vínculo na organização, então o convite não tem criador. A marca é uma coluna própria,
-- porque `created_by` nulo já quer dizer "o criador saiu da equipe", e esse convite não vale.
-- Com a marca, o convite só vale enquanto a organização não tem nenhum vínculo (`invites.ts`).
alter table invites add column installation_invite boolean not null default false;
alter table invites add constraint invites_installation_invite_has_no_creator check (not installation_invite or created_by is null);
