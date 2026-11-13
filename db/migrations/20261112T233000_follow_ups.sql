-- Pendências com dono, prazo e fecho (desenho 2026-11-13-equipe-de-agentes-e-memoria, fatia 1).
-- A pendência nasce na ligação (`create_task`) e é fechada por uma pessoa. O título, os detalhes e a
-- nota de fechamento são texto sobre quem ligou: moram só aqui, onde o prazo de guarda e a
-- exportação os alcançam (registro 0014). Os eventos e os avisos apontam para cá pelo id.

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- A ligação de onde nasceu. Nula se a ligação for apagada: a obrigação com a pessoa continua.
  call_id uuid,
  -- O telefone de quem ligou, em E.164. Nulo quando a ligação não trouxe número.
  caller_e164 text,
  title text not null check (char_length(title) between 1 and 200),
  details text not null default '',
  -- Nulo é "a equipe": aparece para todo mundo, e quem fechar fecha.
  owner_user_id uuid,
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'done', 'canceled')),
  closed_by uuid,
  closed_at timestamptz,
  closing_note text check (char_length(closing_note) <= 500),
  created_at timestamptz not null,
  -- Aberta não tem fecho; fechada sempre tem a hora do fecho, que é de onde o prazo de guarda conta.
  check ((status = 'open') = (closed_at is null)),
  unique (organization_id, id),
  foreign key (organization_id, call_id) references calls (organization_id, id) on delete set null (call_id),
  foreign key (organization_id, owner_user_id) references users (organization_id, id) on delete set null (owner_user_id),
  foreign key (organization_id, closed_by) references users (organization_id, id) on delete set null (closed_by)
);
create index follow_ups_org_status_due_idx on follow_ups (organization_id, status, due_at);
create index follow_ups_call_idx on follow_ups (organization_id, call_id);
create index follow_ups_owner_idx on follow_ups (organization_id, owner_user_id);
create index follow_ups_closed_by_idx on follow_ups (organization_id, closed_by);
create index follow_ups_caller_idx on follow_ups (organization_id, caller_e164);
create index follow_ups_closed_at_idx on follow_ups (organization_id, closed_at) where status <> 'open';

-- Mesmo isolamento das tabelas da fundação.
alter table follow_ups enable row level security;
alter table follow_ups force row level security;
create policy organization_isolation on follow_ups
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
grant select, insert, update, delete on follow_ups to deskvoice_app, deskvoice_system;

-- O aviso do sino aponta para a pendência e tem corpo fixo: o título não é copiado para um lugar
-- que o prazo não alcança. Quando a pendência sai (pelo prazo), o aviso sai com ela.
alter table notifications add column follow_up_id uuid;
alter table notifications
  add foreign key (organization_id, follow_up_id) references follow_ups (organization_id, id) on delete cascade;
create index notifications_follow_up_idx on notifications (organization_id, follow_up_id);

-- "Dono das pendências deste agente", na tela do agente. Nulo: as pendências são da equipe.
-- O modelo nunca escolhe a pessoa: o dono vem daqui.
alter table agents add column follow_up_owner_user_id uuid;
alter table agents
  add foreign key (organization_id, follow_up_owner_user_id) references users (organization_id, id) on delete set null (follow_up_owner_user_id);
create index agents_follow_up_owner_idx on agents (organization_id, follow_up_owner_user_id);
