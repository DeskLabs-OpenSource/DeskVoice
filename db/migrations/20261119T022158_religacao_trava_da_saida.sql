-- A religação conhece a trava da saída (R8, fatia 7b, ajuste 1).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, seção 3.4.
--
-- Quando a administração da instalação bloqueia as ligações de saída de uma organização
-- (`organization_limits.outbound_allowed = false`), a porta única (`checkOutboundAllowed`) recusa
-- com `outbound_not_allowed`. A religação já agendada passa por essa porta e precisa gravar o código
-- em `call_backs.refusal_code`; sem ele no `check`, a recusa viraria `originate_failed`, que é a
-- falha da telefonia.
--
-- A lista é a de `CALL_BACK_REFUSAL_CODES` em packages/core/src/call-backs.ts. A 20261118T225309
-- já saiu na 0.39.0 e não muda. O `check` nasceu sem nome; o Postgres o chamou
-- `call_backs_refusal_code_check` (conferido no catálogo, `pg_constraint`, num banco com todas as
-- migrations até aqui).
--
-- Só alarga a lista: toda linha que já existe continua valendo.

alter table call_backs drop constraint call_backs_refusal_code_check;
alter table call_backs add constraint call_backs_refusal_code_check check (refusal_code in (
  'organization_suspended', 'outbound_disabled', 'outbound_not_allowed', 'outside_window', 'do_not_call', 'daily_cap_reached', 'attempts_exhausted',
  'invalid_number', 'agent_not_found', 'agent_disabled', 'no_line', 'originate_failed'
));
