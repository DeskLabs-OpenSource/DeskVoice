-- Link temporário para o titular baixar a gravação da própria chamada, sem abrir o painel.
-- Guarda só o hash do token: o valor em claro existe uma vez, na resposta da criação, e nunca é
-- gravado. Vazamento do banco não vira vazamento de link.
-- `uses` conta downloads do áudio; abrir a página do link não conta.
create table share_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  call_id uuid not null,
  token_hash text not null unique,
  kind text not null check (kind in ('recording')),
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses > 0),
  uses integer not null default 0 check (uses >= 0 and uses <= max_uses),
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null,
  -- Com a organização na chave: o link nunca aponta para chamada ou pessoa de outra organização.
  foreign key (organization_id, call_id) references calls (organization_id, id) on delete cascade,
  -- Quem criou pode sair da equipe; o link e o registro ficam.
  foreign key (organization_id, created_by) references users (organization_id, id) on delete set null (created_by)
);

create index share_links_call_idx on share_links (call_id) where revoked_at is null;

grant select, insert, update, delete on share_links to deskvoice_app, deskvoice_system;

alter table share_links enable row level security;
alter table share_links force row level security;
create policy share_links_org on share_links
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
