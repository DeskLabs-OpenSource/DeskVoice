-- O custo do teste do agente no extrato (item 7 da pesquisa Vapi, fatia 7b). Desenho:
-- docs/specs/2026-11-21-testes-do-agente.md, seção 5.1.
--
-- Cada `usage` do motor durante uma rodada vira uma linha de `usage_ledger` com `source = 'test'`,
-- sem ligação (`call_id` nulo) e com a rodada (`test_run_id`). Ela entra na mesma soma do mês
-- (`costTotal`) e no mesmo teto de toda linha. Só acrescenta: as linhas de hoje continuam válidas,
-- porque todas têm `call_id` e nenhuma tem `source = 'test'`.
alter table usage_ledger alter column call_id drop not null;
alter table usage_ledger add column test_run_id uuid;

-- Só `test_run_id` vira nulo: `organization_id` é not null, e um "set null" sem lista de colunas
-- anularia as duas e faria o apagamento da rodada falhar. A linha fica, porque o dinheiro foi gasto:
-- o custo do mês não encolhe quando alguém apaga um teste ou a retenção leva a rodada.
alter table usage_ledger add constraint usage_ledger_organization_id_test_run_id_fkey
  foreign key (organization_id, test_run_id) references agent_test_runs (organization_id, id) on delete set null (test_run_id);
create index usage_ledger_test_run_idx on usage_ledger (organization_id, test_run_id) where test_run_id is not null;

-- `source` passa a aceitar 'test'. O check de antes é o da coluna (20261117T081026_analistas.sql:49),
-- com o nome gerado pelo Postgres, conferido no banco: `usage_ledger_source_check`.
alter table usage_ledger drop constraint usage_ledger_source_check;
alter table usage_ledger add constraint usage_ledger_source_check check (source in ('analyst', 'test'));

-- A forma da linha:
--   source = 'test'          → call_id nulo; test_run_id preenchido, ou nulo depois do apagamento;
--   source <> 'test' ou nulo → call_id preenchido e test_run_id nulo, como antes.
--
-- A primeira metade usa `is not distinct from`, e não `=` como o SQL do desenho: com `source` nulo,
-- `source = 'test'` é nulo, o `or` dá nulo, e um `check` nulo passa. A linha sem fonte e sem ligação
-- entraria, e o teste de banco (`cost-of-agent-tests.db.test.ts`) mostrou isso.
alter table usage_ledger add constraint usage_ledger_call_or_test check (
  (source is not distinct from 'test' and call_id is null)
  or (source is distinct from 'test' and call_id is not null and test_run_id is null)
);
