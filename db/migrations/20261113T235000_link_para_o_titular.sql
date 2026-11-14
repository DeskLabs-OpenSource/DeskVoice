-- Link temporário para o titular baixar o que pediu, sem abrir o painel.
-- Guarda só o hash do token: o valor em claro existe uma vez, na resposta da criação, e nunca é
-- gravado. Vazamento do banco não vira vazamento de link.
create table share_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  call_id uuid references calls (id) on delete cascade,
  phone_e164 text,
  token_hash text not null unique,
  kind text not null,
  expires_at timestamptz not null,
  max_uses integer not null,
  uses integer not null default 0,
  revoked_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null
);

create index share_links_call_idx on share_links (call_id) where revoked_at is null;

grant select, insert, update, delete on share_links to deskvoice_app, deskvoice_system;

alter table share_links enable row level security;
alter table share_links force row level security;
create policy share_links_org on share_links
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
