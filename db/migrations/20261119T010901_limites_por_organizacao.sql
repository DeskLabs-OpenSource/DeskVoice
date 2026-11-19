-- Os limites por organização (R8, seção 3.4, fatia 7a).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md.
--
-- Quem administra a instalação limita o que cada organização cria. A tabela nasce inteira, com as
-- quatro colunas da 3.4, mas esta fatia só lê `max_trunks` e `max_agents`: `outbound_allowed` vale a
-- partir da 7b e `monthly_spend_cap_cents` a partir da 7c. Até lá ninguém lê nem grava essas duas.
--
-- Só acrescenta: nenhuma linha é gravada. Organização sem linha não tem limite nenhum, que é o caso
-- de toda instalação de hoje. Coluna nula também quer dizer "sem limite".
--
-- Sem `on delete`: a exclusão de organização é da fatia 9, e ela decide o que acontece aqui.
create table organization_limits (
  organization_id uuid primary key references organizations (id),
  monthly_spend_cap_cents integer check (monthly_spend_cap_cents >= 0),
  max_trunks integer check (max_trunks >= 0),
  max_agents integer check (max_agents >= 0),
  outbound_allowed boolean not null default true,
  updated_at timestamptz not null default now()
);

-- A organização LÊ os próprios limites e nunca os escreve: quem grava é o papel de sistema, pela área
-- da instalação (`setOrganizationLimits` em packages/core). O teste de isolamento gerado cobra esta
-- forma pela lista `SYSTEM_WRITTEN_TABLES`.
grant select on organization_limits to deskvoice_app;
grant select, insert, update, delete on organization_limits to deskvoice_system;

alter table organization_limits enable row level security;
alter table organization_limits force row level security;
create policy organization_limits_org on organization_limits
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
