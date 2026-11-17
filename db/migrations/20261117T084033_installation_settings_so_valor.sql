-- A área da instalação (R8, fatia 2).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, seção 3.2.
--
-- O papel de sistema muda o VALOR de uma configuração da instalação, e nunca a chave. Trocar a
-- chave de `installation.admins_explicit_at` faria a lista deixar de ser explícita sem apagar a
-- linha, e devolveria o papel pela regra da fundadora. `delete` já não existia.
revoke update on installation_settings from deskvoice_system;
grant update (value, updated_at) on installation_settings to deskvoice_system;
