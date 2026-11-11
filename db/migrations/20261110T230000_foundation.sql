-- Fundação do DeskVoice: todas as tabelas, isolamento por organização (RLS) e gatilhos de fila.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Dois papéis, com senhas definidas fora daqui, pelo instalador:
--   deskvoice_app     sem BYPASSRLS: tudo o que faz passa pelas policies de organização.
--   deskvoice_system  com BYPASSRLS: só para o que atravessa organizações (login por e-mail,
--                     fila, roteamento da chamada). É um login separado de propósito: o papel de
--                     aplicação não é membro dele e não tem como virar ele dentro de uma sessão,
--                     então SQL injetado numa consulta de organização não alcança as outras.
do $$
begin
  if not exists (select from pg_roles where rolname = 'deskvoice_app') then
    create role deskvoice_app login nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'deskvoice_system') then
    create role deskvoice_system login nosuperuser bypassrls nocreatedb nocreaterole;
  end if;
end
$$;

grant usage on schema public to deskvoice_app, deskvoice_system;

-- ---------------------------------------------------------------------------------------------
-- Tabelas
--
-- Toda referência entre tabelas de produto é composta (organization_id, id): a checagem de
-- chave estrangeira ignora RLS, então só a chave composta impede uma linha da organização B
-- de apontar para uma linha da organização A.
-- ---------------------------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- Único na instalação inteira: o login acha a organização pelo e-mail.
  email citext not null unique,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('owner', 'admin', 'operator')),
  phone_e164 text,
  whatsapp_e164 text,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  user_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  foreign key (organization_id, user_id) references users (organization_id, id) on delete cascade
);
create index sessions_user_idx on sessions (organization_id, user_id);

create table settings (
  organization_id uuid not null references organizations (id),
  key text not null,
  value jsonb not null,
  secret boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (organization_id, key)
);

create table trunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  name text not null,
  host text not null,
  username text,
  secret_enc text,
  auth_mode text not null check (auth_mode in ('register', 'ip')),
  caller_id_e164 text,
  status text not null default 'unverified',
  last_check_at timestamptz,
  last_error text,
  unique (organization_id, id)
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  name text not null,
  role_label text,
  instructions text not null default '',
  greeting text,
  engine text not null,
  voice_id text,
  language text not null default 'pt-BR',
  tools text[] not null default '{}',
  enabled boolean not null default true,
  max_call_seconds integer not null default 600 check (max_call_seconds > 0),
  cost_ceiling_cents integer not null default 500 check (cost_ceiling_cents >= 0),
  transfer_to_e164 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table phone_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  trunk_id uuid not null,
  e164 text not null,
  agent_id uuid,
  -- Único por organização, não na instalação: unicidade global deixaria uma organização reservar
  -- o número de outra. A chamada recebida é roteada pelo tronco por onde chegou (que tem dona) e
  -- só então pelo número, dentro dessa organização.
  unique (organization_id, e164),
  foreign key (organization_id, trunk_id) references trunks (organization_id, id) on delete cascade,
  foreign key (organization_id, agent_id) references agents (organization_id, id) on delete set null (agent_id)
);
create index phone_numbers_trunk_idx on phone_numbers (organization_id, trunk_id);
create index phone_numbers_agent_idx on phone_numbers (organization_id, agent_id);

create table calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- Nulo quando a chamada é recusada antes de achar um agente.
  agent_id uuid,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_e164 text,
  to_e164 text,
  status text not null check (status in ('ringing', 'in_progress', 'transferred', 'completed', 'failed', 'refused')),
  end_reason text,
  engine text,
  started_at timestamptz not null,
  answered_at timestamptz,
  ended_at timestamptz,
  cost_cents integer not null default 0,
  summary text,
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references agents (organization_id, id) on delete set null (agent_id)
);
create index calls_org_started_idx on calls (organization_id, started_at desc);
create index calls_org_status_idx on calls (organization_id, status);
create index calls_agent_idx on calls (organization_id, agent_id);

create table call_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations (id),
  call_id uuid not null,
  at timestamptz not null,
  kind text not null,
  payload jsonb not null default '{}',
  foreign key (organization_id, call_id) references calls (organization_id, id) on delete cascade
);
create index call_events_call_idx on call_events (call_id, id);
create index call_events_org_idx on call_events (organization_id, id);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  call_id uuid not null,
  question text not null,
  context jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')),
  default_on_timeout text not null check (default_on_timeout in ('approved', 'denied')),
  expires_at timestamptz not null,
  decided_by uuid,
  decided_at timestamptz,
  foreign key (organization_id, call_id) references calls (organization_id, id) on delete cascade,
  foreign key (organization_id, decided_by) references users (organization_id, id) on delete set null (decided_by)
);
create index approvals_org_status_idx on approvals (organization_id, status);
create index approvals_call_idx on approvals (organization_id, call_id);
create index approvals_pending_expiry_idx on approvals (expires_at) where status = 'pending';

create table tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  call_id uuid,
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, call_id) references calls (organization_id, id) on delete set null (call_id)
);
create index tasks_status_run_at_idx on tasks (status, run_at);
create index tasks_call_idx on tasks (organization_id, call_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  call_id uuid,
  channel text not null check (channel in ('panel', 'whatsapp', 'webhook')),
  target text,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (organization_id, call_id) references calls (organization_id, id) on delete set null (call_id)
);
create index notifications_org_created_idx on notifications (organization_id, created_at desc);
create index notifications_call_idx on notifications (organization_id, call_id);

create table outbound_policy (
  organization_id uuid primary key references organizations (id),
  enabled boolean not null default false,
  purpose text,
  legal_basis text,
  daily_cap_per_line integer not null default 200,
  window_start time not null default '09:00',
  window_end time not null default '20:00',
  max_attempts_per_contact integer not null default 3,
  timezone text not null default 'America/Sao_Paulo'
);

create table do_not_call (
  organization_id uuid not null references organizations (id),
  e164 text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (organization_id, e164)
);

create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  call_id uuid not null,
  engine text not null,
  seconds integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_cents integer not null default 0,
  at timestamptz not null,
  foreign key (organization_id, call_id) references calls (organization_id, id) on delete cascade
);
create index usage_ledger_org_at_idx on usage_ledger (organization_id, at);
create index usage_ledger_call_idx on usage_ledger (organization_id, call_id);

-- ---------------------------------------------------------------------------------------------
-- Isolamento por organização
--
-- A linha só passa quando pertence à organização da transação (`withOrg`). Não existe variável
-- de sessão que abra as outras: quem atravessa organizações é o papel deskvoice_system.
-- O nullif existe porque uma configuração local volta a ser texto vazio na conexão reaproveitada
-- do pool, e ''::uuid seria erro em vez de "nenhuma".
-- ---------------------------------------------------------------------------------------------

do $$
declare
  t text;
  org_column text;
begin
  foreach t in array array[
    'organizations', 'users', 'sessions', 'settings', 'trunks', 'agents', 'phone_numbers', 'calls',
    'call_events', 'approvals', 'tasks', 'notifications', 'outbound_policy', 'do_not_call', 'usage_ledger'
  ]
  loop
    org_column := case when t = 'organizations' then 'id' else 'organization_id' end;
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy organization_isolation on %I
         using (%I = nullif(current_setting(''app.organization_id'', true), '''')::uuid)
         with check (%I = nullif(current_setting(''app.organization_id'', true), '''')::uuid)',
      t, org_column, org_column
    );
    execute format('grant select, insert, update, delete on %I to deskvoice_app, deskvoice_system', t);
  end loop;
end
$$;

grant usage, select on sequence call_events_id_seq to deskvoice_app, deskvoice_system;

-- ---------------------------------------------------------------------------------------------
-- Notificações: a fila e a tela acordam por LISTEN, sem polling.
-- ---------------------------------------------------------------------------------------------

create function notify_task_queued() returns trigger language plpgsql as $$
begin
  perform pg_notify('tasks', new.id::text);
  return null;
end
$$;
create trigger tasks_notify after insert on tasks
  for each row execute function notify_task_queued();

create function notify_approval_status() returns trigger language plpgsql as $$
begin
  perform pg_notify('approvals', new.id::text);
  return null;
end
$$;
create trigger approvals_notify after update of status on approvals
  for each row when (old.status is distinct from new.status) execute function notify_approval_status();

create function notify_call_event() returns trigger language plpgsql as $$
begin
  perform pg_notify('call_events', new.organization_id::text || ':' || new.call_id::text || ':' || new.id::text);
  return null;
end
$$;
create trigger call_events_notify after insert on call_events
  for each row execute function notify_call_event();
