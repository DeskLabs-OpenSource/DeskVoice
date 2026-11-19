-- A religação da ligação que caiu (desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.6, fatia 3).
--
-- Cada linha é uma tentativa de ligar de volta para quem ligou e caiu. Ela nasce na revisão
-- (`review_call`, modo `call_back`), fica `due` na hora marcada (rotina `call_back`) e só vira
-- chamada pelo processo de voz, por `startOutboundCall`, que confere a política de saída na hora de
-- discar. Nada aqui origina chamada.
--
-- O índice único por (ligação original, tentativa) impede duas tentativas com o mesmo número de ordem,
-- e o `check` do `attempt` é o teto de tentativas fixo no código (no máximo 3): duas das travas contra
-- o laço. Nada muda para quem já instalou: a tabela nasce vazia, e o modo `call_back` continua fora
-- da rota do painel nesta fatia.
create table call_backs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- A ligação recebida que caiu. Sem ela não há religação: sai junto.
  origin_call_id uuid not null,
  -- O agente que atendeu a original (`calls.agent_id`): é ele quem liga de volta.
  agent_id uuid,
  -- O número de quem ligou, em E.164. O apagamento a pedido do titular o anula (e cancela a que ainda
  -- não saiu): o número apagado não fica guardado aqui.
  to_e164 text,
  attempt int not null check (attempt between 1 and 3),
  due_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'due', 'placed', 'refused', 'expired', 'cancelled')),
  -- A chamada que a tentativa criou, inclusive a recusada pela política.
  result_call_id uuid,
  -- Por que a tentativa não saiu: um código da política (`OutboundRefusalCode`), uma recusa de
  -- `startOutboundCall` antes de criar a chamada, ou `originate_failed`.
  refusal_code text check (refusal_code in (
    'organization_suspended', 'outbound_disabled', 'outside_window', 'do_not_call', 'daily_cap_reached', 'attempts_exhausted',
    'invalid_number', 'agent_not_found', 'agent_disabled', 'no_line', 'originate_failed'
  )),
  created_at timestamptz not null,
  check ((status = 'refused') = (refusal_code is not null)),
  unique (organization_id, id),
  unique (organization_id, origin_call_id, attempt),
  foreign key (organization_id, origin_call_id) references calls (organization_id, id) on delete cascade,
  foreign key (organization_id, result_call_id) references calls (organization_id, id) on delete set null (result_call_id),
  foreign key (organization_id, agent_id) references agents (organization_id, id) on delete set null (agent_id)
);
-- O processo de voz procura as linhas `due`; a revisão procura pelo número nas últimas 24 horas.
create index call_backs_due_idx on call_backs (status, due_at) where status = 'due';
create index call_backs_to_idx on call_backs (organization_id, to_e164, created_at);
create index call_backs_result_idx on call_backs (organization_id, result_call_id);
create index call_backs_agent_idx on call_backs (organization_id, agent_id);

-- Mesmo isolamento de `follow_ups`.
alter table call_backs enable row level security;
alter table call_backs force row level security;
create policy organization_isolation on call_backs
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on call_backs to deskvoice_app, deskvoice_system;

-- A religação aponta para a ligação original. Nula em toda ligação de antes e em toda ligação que não
-- é religação. A revisão de uma ligação com `call_back_of` nunca gera outra religação.
alter table calls add column call_back_of uuid;
alter table calls
  add foreign key (organization_id, call_back_of) references calls (organization_id, id) on delete set null (call_back_of);
create index calls_call_back_of_idx on calls (organization_id, call_back_of) where call_back_of is not null;
