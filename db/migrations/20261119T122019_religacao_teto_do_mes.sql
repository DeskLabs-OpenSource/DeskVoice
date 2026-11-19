-- A religação conhece o teto de gasto do mês (R8, fatia 7c).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, seção 3.4.
--
-- Quando a soma do mês de uma organização chega a `organization_limits.monthly_spend_cap_cents`, a
-- porta única da saída (`checkOutboundAllowed`) recusa com `spend_cap_reached`. A religação já
-- agendada passa por essa porta e precisa gravar o código em `call_backs.refusal_code`; sem ele no
-- `check`, a recusa viraria `originate_failed`, que é a falha da telefonia.
--
-- A lista é a de `CALL_BACK_REFUSAL_CODES` em packages/core/src/call-backs.ts. A 20261119T022158
-- não muda; esta troca o mesmo `check` (`call_backs_refusal_code_check`) pela lista alargada.
--
-- Só alarga a lista: toda linha que já existe continua valendo.

alter table call_backs drop constraint call_backs_refusal_code_check;
alter table call_backs add constraint call_backs_refusal_code_check check (refusal_code in (
  'organization_suspended', 'outbound_disabled', 'outbound_not_allowed', 'spend_cap_reached', 'outside_window', 'do_not_call', 'daily_cap_reached', 'attempts_exhausted',
  'invalid_number', 'agent_not_found', 'agent_disabled', 'no_line', 'originate_failed'
));
