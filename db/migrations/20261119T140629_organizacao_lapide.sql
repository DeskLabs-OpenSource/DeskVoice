-- A lápide da exclusão de organização (R8, fatia 9b).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, 3.3 e "Fatia 9".
--
-- `deleting_at` marca a organização que a administração mandou excluir. Daí em diante ela não volta
-- (reativar é recusado) e a rotina de `apps/routines` termina a exclusão: a sessão do WhatsApp, a
-- pasta das gravações, o `delete` em cascata (fatia 9a), as contas que ficaram sem vínculo e o
-- registro na auditoria da instalação. A lápide é o que faz a limpeza retomar depois de um reinício.
--
-- `deleting_by` aponta para a CONTA de quem pediu, e não para um vínculo: quem administra a
-- instalação pode não ter vínculo nesta organização. É chave para `accounts`, e não para
-- `organizations`, então o teste da cascata (`organization-cascade.db.test.ts`) não a vê.
--
-- Trava: três colunas anuláveis sem valor padrão só mexem no catálogo, sem regravar a tabela.
alter table organizations
  add column deleting_at timestamptz,
  add column deleting_reason text,
  add column deleting_by uuid references accounts (id) on delete set null;
