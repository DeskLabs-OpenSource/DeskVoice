-- Atualizar pela tela: o painel só registra o pedido; quem atualiza é o agente do kit, no servidor.

-- Um pedido de atualização. `organization_id` é a organização de quem pediu; a atualização em si
-- é da instalação inteira. O painel nunca grava aqui para qual versão ir: `to_version` é o que o
-- agente contou depois de terminar.
create table update_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  requested_by uuid,
  status text not null default 'requested'
    check (status in ('requested', 'running', 'succeeded', 'nothing_to_do', 'rolled_back', 'failed', 'expired', 'superseded')),
  from_version text not null,
  -- A versão que a pessoa viu e confirmou na tela. É só para COMPARAR com a que o agente anuncia:
  -- se o servidor passou a enxergar outra, o pedido termina como `superseded` e ninguém é
  -- atualizado para uma versão que não confirmou. Nunca é entregue ao agente.
  target_version text not null,
  to_version text,
  detail text,
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  finished_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, requested_by) references users (organization_id, id) on delete set null (requested_by)
);
-- Um pedido aberto por vez na INSTALAÇÃO, e não por organização: o índice não tem coluna.
create unique index update_requests_one_open_idx on update_requests ((true)) where status in ('requested', 'running');
create index update_requests_org_idx on update_requests (organization_id, requested_at desc);
create index update_requests_requested_by_idx on update_requests (organization_id, requested_by);

-- O que o agente disse por último. Ele fala pela instalação, então cada organização recebe a
-- mesma linha: assim a tela lê a sua com `withOrg`, como qualquer outro dado.
create table update_agent_status (
  organization_id uuid primary key references organizations (id),
  last_seen_at timestamptz not null,
  announced_version text not null,
  -- Para qual versão o servidor iria agora (a maior tag final do clone). Nula = já está nela.
  target_version text,
  last_failure_at timestamptz,
  last_failure_detail text
);

-- Mesmo isolamento das tabelas da fundação.
alter table update_requests enable row level security;
alter table update_requests force row level security;
create policy organization_isolation on update_requests
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on update_requests to deskvoice_app, deskvoice_system;

alter table update_agent_status enable row level security;
alter table update_agent_status force row level security;
create policy organization_isolation on update_agent_status
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on update_agent_status to deskvoice_app, deskvoice_system;
