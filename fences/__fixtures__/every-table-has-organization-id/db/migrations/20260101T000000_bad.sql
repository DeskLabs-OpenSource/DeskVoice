create table organizations (id uuid primary key, name text not null);

create table agents (
  id uuid primary key,
  organization_id uuid not null references organizations (id),
  name text not null check (length(name) > 0)
);

-- A coluna citada só em comentário não conta.
create table if not exists notes (
  id uuid primary key,
  -- organization_id uuid not null,
  body text not null
);

-- Citar a coluna numa restrição não a declara.
create table sessions (
  id uuid primary key,
  user_id uuid not null,
  foreign key (organization_id, user_id) references users (organization_id, id)
);

-- Coluna que aceita nulo deixa linha sem dono.
create table drafts (
  id uuid primary key,
  organization_id uuid references organizations (id)
);

-- Chave primária já implica not null.
create table outbound_policy (
  organization_id uuid primary key references organizations (id),
  enabled boolean not null default false
);
