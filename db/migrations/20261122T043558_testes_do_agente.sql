-- Os testes do agente (item 7 da pesquisa Vapi, fatia 7a). Desenho:
-- docs/specs/2026-11-21-testes-do-agente.md, seção 5.1.
--
-- Um teste é uma conversa escrita pelo operador (o que quem liga diz, turno a turno) com o que se
-- espera do agente em cada turno. Uma rodada é uma execução do teste, com o veredito de cada turno.
-- Teste não é ligação: nada aqui entra em `calls` nem em `call_events`. Só acrescenta: quem já
-- instalou não vê mudança até criar um teste. O extrato (`usage_ledger`) não muda nesta fatia: a
-- linha de custo de teste é da 7b.
--
-- A chave para `organizations (id)` é `on delete cascade`, como toda outra (20261119T043612,
-- `organization-cascade.db.test.ts`). O SQL do desenho não trazia a cascata.
create table agent_tests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  agent_id uuid not null,
  name text not null check (length(name) between 1 and 120),
  -- Validado por zod em `packages/core/src/agent-tests.ts` (`agentTestTurns`); o banco não interpreta.
  turns jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- Com a organização na chave: o teste nunca aponta para o agente de outra. Apagar o agente leva os testes.
  foreign key (organization_id, agent_id) references agents (organization_id, id) on delete cascade
);
create index agent_tests_agent_idx on agent_tests (organization_id, agent_id);

create table agent_test_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  test_id uuid not null,
  status text not null check (status in ('running', 'passed', 'failed', 'error')),
  error_code text check (error_code in ('turn_timeout', 'tool_loop', 'cost_ceiling', 'engine_failed', 'process_restarted')),
  engine text not null,
  model text,
  -- O retrato da configuração que o modelo recebeu (`configHash`): muda quando as instruções, as
  -- ferramentas, o motor, o modelo ou o idioma mudam.
  config_hash text not null,
  -- O que aconteceu, turno a turno, com o veredito de cada um.
  turns jsonb not null default '[]',
  -- Quem pediu a rodada. Sem chave: a rodada fica mesmo que a pessoa saia da organização.
  requested_by uuid,
  started_at timestamptz not null,
  finished_at timestamptz,
  unique (organization_id, id),
  -- Código só com erro, e erro sempre com código.
  check ((status = 'error') = (error_code is not null)),
  -- Apagar o teste leva as rodadas.
  foreign key (organization_id, test_id) references agent_tests (organization_id, id) on delete cascade
);
create index agent_test_runs_test_idx on agent_test_runs (organization_id, test_id, started_at desc);

-- Mesmo isolamento das outras tabelas da organização.
alter table agent_tests enable row level security;
alter table agent_tests force row level security;
create policy organization_isolation on agent_tests
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on agent_tests to deskvoice_app, deskvoice_system;

alter table agent_test_runs enable row level security;
alter table agent_test_runs force row level security;
create policy organization_isolation on agent_test_runs
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on agent_test_runs to deskvoice_app, deskvoice_system;
