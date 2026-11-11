-- Equipe e convites: entra-se no painel por convite, nunca por cadastro aberto.

-- Nula = pessoa ativa. Desativar (em vez de apagar) preserva quem decidiu cada aprovação.
alter table users add column disabled_at timestamptz;

-- O link do convite carrega um token; aqui fica só o resumo dele. O convite vale uma vez.
create table invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  email citext not null,
  name text not null,
  role text not null check (role in ('owner', 'admin', 'operator')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid,
  accepted_at timestamptz,
  accepted_user_id uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id) on delete set null (created_by),
  foreign key (organization_id, accepted_user_id) references users (organization_id, id) on delete set null (accepted_user_id)
);
-- Um convite pendente por e-mail em cada organização: convidar de novo revoga o anterior.
create unique index invites_one_pending_idx on invites (organization_id, email) where accepted_at is null and revoked_at is null;
create index invites_created_by_idx on invites (organization_id, created_by);
create index invites_accepted_user_idx on invites (organization_id, accepted_user_id);

-- Mesmo isolamento das tabelas da fundação.
alter table invites enable row level security;
alter table invites force row level security;
create policy organization_isolation on invites
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on invites to deskvoice_app, deskvoice_system;
