-- A tarefa cancelada (R8, fatia 4b). Desenho:
-- docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, seção 3.3: a
-- suspensão "cancela as tarefas `queued` daquela organização, com o motivo
-- `organization_suspended`", e a reativação cancela as que entraram durante a suspensão.
--
-- Só alarga o `check` de `tasks.status`: nenhuma linha muda. A tarefa `canceled` não é elegível
-- para a fila (`claimTask` só pega `queued`), não conta como pendente nem como falha na saúde, e a
-- faxina do runner leva as canceladas antigas junto com as concluídas.
--
-- O `check` nasceu sem nome na fundação; o Postgres o chamou `tasks_status_check` (conferido no
-- catálogo, `pg_constraint`, num banco com todas as migrations até aqui).

alter table tasks drop constraint tasks_status_check;
alter table tasks add constraint tasks_status_check check (status in ('queued', 'running', 'done', 'failed', 'canceled'));
