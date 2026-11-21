-- O idioma com que uma organização nova nasce (R8, fatia 8a, metade do idioma).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, 3.5 e "Fatia 8";
-- decisão de forma do Arquiteto na DESA-208 (opção A, coluna anulável).
--
-- `language` é o idioma que os formulários de agente novo e de menu novo da organização PROPÕEM. Não
-- muda nenhum agente nem menu que já existe, nem a língua da tela (que segue no cookie `dv_locale`).
-- `addOrganization` grava aqui uma CÓPIA de `defaults.language` da instalação; sem padrão, fica nula.
--
-- Sem valor padrão de propósito: as organizações que já existem ficam nulas, e o formulário propõe
-- pt-BR como sempre. Um padrão 'pt-BR' na coluna viraria um valor que parece escolhido.
--
-- Trava: coluna anulável sem valor padrão, com `check` que aceita nulo, só mexe no catálogo e lê a
-- tabela uma vez para conferir o `check` (todas nulas).
alter table organizations
  add column language text check (language in ('pt-BR', 'en', 'es'));
