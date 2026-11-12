-- Eventos da organização: o que acontece fora de uma chamada e precisa ficar registrado, com quem
-- fez e quando. Nasce para os direitos de quem ligou (registro 0014): a mudança do prazo de guarda
-- da transcrição, cada expurgo feito pela rotina e cada exportação dos dados de um telefone.
-- `call_events` continua sendo a linha do tempo da chamada; aqui fica o que não pertence a uma.

create table organization_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations (id),
  at timestamptz not null,
  -- Vocabulário fechado em packages/core (`ORG_EVENT_KINDS`).
  kind text not null,
  -- Quem fez, quando foi uma pessoa. Nulo quando foi uma rotina, ou se a pessoa saiu da equipe.
  actor_user_id uuid,
  payload jsonb not null default '{}',
  foreign key (organization_id, actor_user_id) references users (organization_id, id) on delete set null (actor_user_id)
);
create index organization_events_org_at_idx on organization_events (organization_id, at desc);
create index organization_events_actor_idx on organization_events (organization_id, actor_user_id);

-- Mesmo isolamento das tabelas da fundação.
alter table organization_events enable row level security;
alter table organization_events force row level security;
create policy organization_isolation on organization_events
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on organization_events to deskvoice_app, deskvoice_system;
grant usage, select on sequence organization_events_id_seq to deskvoice_app, deskvoice_system;
