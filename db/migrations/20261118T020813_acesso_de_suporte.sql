-- O acesso de suporte da instalação (R8, fatia 5c). Desenho:
-- docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, seção 3.6.
--
-- Quem administra a instalação entra numa organização com motivo e prazo (15, 30 ou 60 minutos), por
-- um vínculo `users.kind = 'support'` com papel `admin`. Cada acesso é uma linha daqui, que a
-- organização vê pela mesma porta de sempre (RLS). A sessão que está no acesso aponta para ele.
--
-- Só acrescenta: nenhuma linha muda, `sessions.support_access_id` nasce nulo em toda sessão, e
-- ninguém ganha vínculo de suporte sem uma ação da administração.
create table support_accesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- O vínculo de suporte (users.kind = 'support') criado ou reativado para este acesso.
  user_id uuid not null,
  reason text not null check (char_length(reason) between 10 and 500),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  -- `now` quando a pessoa encerra; `expires_at` quando o prazo vence. Nulo enquanto vale.
  ended_at timestamptz,
  unique (organization_id, id),
  check (expires_at > started_at),
  check (ended_at is null or ended_at >= started_at),
  foreign key (organization_id, user_id) references users (organization_id, id)
);
create index support_accesses_org_started_idx on support_accesses (organization_id, started_at desc);
create index support_accesses_user_idx on support_accesses (organization_id, user_id);

grant select, insert, update, delete on support_accesses to deskvoice_app, deskvoice_system;

alter table support_accesses enable row level security;
alter table support_accesses force row level security;
create policy support_accesses_org on support_accesses
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- A sessão que está num acesso de suporte. Com a organização na chave: a sessão nunca aponta para o
-- acesso de outra organização.
alter table sessions add column support_access_id uuid;
alter table sessions
  add foreign key (organization_id, support_access_id) references support_accesses (organization_id, id);
create index sessions_support_access_idx on sessions (organization_id, support_access_id) where support_access_id is not null;
