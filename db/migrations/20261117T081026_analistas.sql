-- Os analistas ao vivo (desenho 2026-11-17-analistas-ao-vivo, seção 3.1, fatia 2).
--
-- O analista é configuração do operador: um nome, o modelo de decisão que ele usa, se lê a
-- temperatura e as objeções com a orientação que o agente recebe. Só acrescenta: nenhuma instalação
-- tem analista, e `agents.analyst_id` nasce nulo. Quem já instalou não percebe diferença.
create table analysts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  -- `citext`, como o e-mail: "Jev" e "jev" são o mesmo nome na organização.
  name citext not null check (char_length(name) between 1 and 40),
  -- Id de um modelo de decisão instalado (`deciders/`). Quem confere é a rota, ao salvar.
  decision_model text not null,
  temperature boolean not null default true,
  -- [{ key, label, guidance }], de 0 a 8. A forma de cada item é do zod de `packages/core/src/analysts.ts`.
  objections jsonb not null default '[]'
    check (jsonb_typeof(objections) = 'array' and jsonb_array_length(objections) <= 8),
  -- Quem confirmou que o texto da ligação vai ao fornecedor do modelo, e quando (seção 2.1). Nulos com
  -- um modelo que processa neste servidor. A pessoa pode sair da equipe: o `set null` vale como em
  -- todo `*_by`, e a prova fica no recibo `analyst_provider_confirmed` de `organization_events`, com o
  -- nome dela no momento.
  provider_confirmed_by uuid,
  provider_confirmed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (organization_id, id),
  unique (organization_id, name),
  check (provider_confirmed_by is null or provider_confirmed_at is not null),
  foreign key (organization_id, provider_confirmed_by) references users (organization_id, id) on delete set null (provider_confirmed_by)
);
create index analysts_confirmed_by_idx on analysts (organization_id, provider_confirmed_by);

grant select, insert, update, delete on analysts to deskvoice_app, deskvoice_system;

alter table analysts enable row level security;
alter table analysts force row level security;
create policy analysts_org on analysts
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- Zero ou um analista por agente; o mesmo analista serve a vários. Com a organização na chave: o
-- agente nunca aponta para analista de outra organização. Apagar o analista deixa o agente sem ele.
alter table agents add column analyst_id uuid;
alter table agents
  add foreign key (organization_id, analyst_id) references analysts (organization_id, id) on delete set null (analyst_id);
create index agents_analyst_idx on agents (organization_id, analyst_id);

-- `analyst` nas linhas de custo do analista (escritas na fatia 3); nulo no resto. Separa no extrato o
-- custo do analista do custo do filtro da fala quando os dois usam o mesmo modelo.
alter table usage_ledger add column source text check (source in ('analyst'));
