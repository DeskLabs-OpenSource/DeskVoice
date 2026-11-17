-- Contas e o papel da instalação (R8, fatia 1).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, seções 3.1,
-- 3.2, 3.5 (só `installation_settings`), 3.8 (só `installation_events`) e 3.9.
--
-- A conta (e-mail, senha e a marca de quem administra a instalação) sai de `users`. `users`
-- continua igual e passa a ser o VÍNCULO de uma conta com uma organização, com o papel que ela tem
-- ali. Nenhuma chave estrangeira que aponta para `users` muda.
--
-- As três tabelas novas não têm `organization_id`: são da instalação. Ficam com RLS ligado e
-- forçado, sem policy, e sem nenhum direito para `deskvoice_app`. Se alguém um dia der `grant` por
-- engano, a tabela continua sem linha visível para o papel de aplicação. Só o papel de sistema as
-- lê, e só pelas funções de `packages/core/src/accounts.ts` e `packages/core/src/installation.ts`.

-- ---------------------------------------------------------------------------------------------
-- Contas
-- ---------------------------------------------------------------------------------------------

create table accounts (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  -- Nula = a marca não existe. A regra de quem administra mora em `isInstallationAdmin`.
  installation_admin_at timestamptz,
  -- A organização em que a conta entrou por último: o login volta para ela (fatia 3).
  last_organization_id uuid references organizations (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table accounts enable row level security;
alter table accounts force row level security;
grant select, insert, update on accounts to deskvoice_system;

-- Uma conta por usuário. Até aqui o e-mail era único na instalação, então a correspondência é de um
-- para um e não há conflito a resolver.
insert into accounts (email, password_hash, created_at)
select email, password_hash, created_at from users;

alter table users add column account_id uuid references accounts (id);
update users u set account_id = a.id from accounts a where a.email = u.email;
alter table users alter column account_id set not null;
-- `support` é o vínculo do "entrar como" (fatia 5). Nasce aqui só como coluna: nenhum código o cria.
alter table users add column kind text not null default 'member' check (kind in ('member', 'support'));
create unique index users_one_membership_idx on users (organization_id, account_id);
create index users_account_idx on users (account_id);

-- A senha mora só na conta. O painel, o processo de voz e as rotinas sobem juntos na atualização.
alter table users drop column password_hash;

-- A sessão sabe de que conta é. O par `organization_id` e `user_id` diz em que organização ela está.
alter table sessions add column account_id uuid references accounts (id);
update sessions s set account_id = u.account_id from users u where u.id = s.user_id;
alter table sessions alter column account_id set not null;
create index sessions_account_idx on sessions (account_id);

-- ---------------------------------------------------------------------------------------------
-- Organização: só as colunas da suspensão (fatia 4 as usa)
-- ---------------------------------------------------------------------------------------------

alter table organizations add column suspended_at timestamptz;
alter table organizations add column suspended_reason text;

-- ---------------------------------------------------------------------------------------------
-- Configurações da instalação
-- ---------------------------------------------------------------------------------------------

create table installation_settings (
  key text primary key,
  value jsonb not null,
  secret boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table installation_settings enable row level security;
alter table installation_settings force row level security;
-- Sem `delete`: `installation.admins_explicit_at` nunca volta a ser apagada (seção 3.2).
grant select, insert, update on installation_settings to deskvoice_system;

-- ---------------------------------------------------------------------------------------------
-- Auditoria da instalação
-- ---------------------------------------------------------------------------------------------

create table installation_events (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  -- Vocabulário fechado em packages/core (`INSTALLATION_EVENT_KINDS`).
  kind text not null,
  actor_account_id uuid references accounts (id) on delete set null,
  organization_id uuid references organizations (id) on delete set null,
  payload jsonb not null default '{}'
);
create index installation_events_at_idx on installation_events (at desc);
alter table installation_events enable row level security;
alter table installation_events force row level security;
-- Só de acréscimo, como `organization_events`.
grant select, insert on installation_events to deskvoice_system;
grant usage, select on sequence installation_events_id_seq to deskvoice_system;

-- ---------------------------------------------------------------------------------------------
-- Quem administra a instalação: estado gravado, nunca a contagem de organizações (seção 3.2)
-- ---------------------------------------------------------------------------------------------

-- A organização de quem instalou: a mais antiga. Nunca muda depois. Numa instalação nova ainda não
-- há organização, e quem a grava é `create-owner`, ao criar a primeira.
insert into installation_settings (key, value)
select 'installation.founding_organization_id', to_jsonb(id::text)
  from organizations
 order by created_at, id
 limit 1;

-- Mais de uma organização (só possível hoje por quem tem acesso à VPS): a lista fica explícita
-- agora, e os donos ativos da fundadora recebem a marca. Com uma organização só, ninguém é marcado:
-- dono e administrador dela continuam administrando pela regra da fundadora.
do $$
declare
  founding uuid;
begin
  if (select count(*) from organizations) > 1 then
    select (value #>> '{}')::uuid into founding from installation_settings where key = 'installation.founding_organization_id';
    with granted as (
      update accounts a
         set installation_admin_at = now()
        from users u
       where u.account_id = a.id
         and u.organization_id = founding
         and u.kind = 'member'
         and u.role = 'owner'
         and u.disabled_at is null
         and a.installation_admin_at is null
      returning a.id
    )
    insert into installation_events (at, kind, actor_account_id, organization_id, payload)
    select now(), 'installation_admin_granted', null, founding, jsonb_build_object('account_id', granted.id, 'source', 'migration')
      from granted;
    insert into installation_settings (key, value) values ('installation.admins_explicit_at', to_jsonb(now()));
  end if;
end
$$;
