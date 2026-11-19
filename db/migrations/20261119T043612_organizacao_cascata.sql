-- A cascata da exclusão de organização (R8, fatia 9a).
-- Desenho: docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md, "Fatia 9".
--
-- Toda chave estrangeira para `organizations (id)` passa a `on delete cascade`: apagar a organização
-- apaga as linhas dela em todas as tabelas, e nenhuma fica órfã. Esta fatia só prepara o banco:
-- nenhuma rota, tela ou rotina apaga organização ainda (a exclusão é da fatia 9b).
--
-- A lista abaixo foi gerada do catálogo (`pg_constraint` das chaves que apontam para `organizations`
-- sem `on delete cascade` nem `on delete set null`) e gravada como SQL estático. Cada chave mantém o
-- nome que tinha. As três que já eram `cascade` (`analysts`, `ivr_menus`, `share_links`) ficam como
-- estão.
--
-- Ficam `on delete set null` de propósito, e o teste nomeia o motivo:
--   - `installation_events.organization_id`: o registro da instalação guarda a própria exclusão;
--   - `accounts.last_organization_id`: só manda o login para outro vínculo.
--
-- O teste `packages/core/test/organization-cascade.db.test.ts` lê o catálogo e reprova a chave nova
-- para `organizations (id)` que nascer sem cascata e fora da lista de exceções.
--
-- Trava: cada `alter table` pega `access exclusive` na tabela dele e em `organizations` (o `drop
-- constraint` tira os gatilhos da chave dos dois lados) e confere as linhas existentes contra
-- `organizations`. A migration roda numa transação só, então as 26 tabelas ficam travadas até o fim
-- dela. Medido sobre um banco da 0.39.0 com 1,8 milhão de linhas: 261 ms.
alter table agents
  drop constraint agents_organization_id_fkey,
  add constraint agents_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table approvals
  drop constraint approvals_organization_id_fkey,
  add constraint approvals_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table call_backs
  drop constraint call_backs_organization_id_fkey,
  add constraint call_backs_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table caller_notes
  drop constraint caller_notes_organization_id_fkey,
  add constraint caller_notes_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table call_events
  drop constraint call_events_organization_id_fkey,
  add constraint call_events_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table calls
  drop constraint calls_organization_id_fkey,
  add constraint calls_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table do_not_call
  drop constraint do_not_call_organization_id_fkey,
  add constraint do_not_call_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table follow_ups
  drop constraint follow_ups_organization_id_fkey,
  add constraint follow_ups_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table invites
  drop constraint invites_organization_id_fkey,
  add constraint invites_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table notifications
  drop constraint notifications_organization_id_fkey,
  add constraint notifications_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table organization_events
  drop constraint organization_events_organization_id_fkey,
  add constraint organization_events_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table organization_limits
  drop constraint organization_limits_organization_id_fkey,
  add constraint organization_limits_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table outbound_policy
  drop constraint outbound_policy_organization_id_fkey,
  add constraint outbound_policy_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table phone_numbers
  drop constraint phone_numbers_organization_id_fkey,
  add constraint phone_numbers_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table sessions
  drop constraint sessions_organization_id_fkey,
  add constraint sessions_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table settings
  drop constraint settings_organization_id_fkey,
  add constraint settings_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table support_accesses
  drop constraint support_accesses_organization_id_fkey,
  add constraint support_accesses_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table tasks
  drop constraint tasks_organization_id_fkey,
  add constraint tasks_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table trunks
  drop constraint trunks_organization_id_fkey,
  add constraint trunks_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table update_agent_status
  drop constraint update_agent_status_organization_id_fkey,
  add constraint update_agent_status_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table update_requests
  drop constraint update_requests_organization_id_fkey,
  add constraint update_requests_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table usage_ledger
  drop constraint usage_ledger_organization_id_fkey,
  add constraint usage_ledger_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table users
  drop constraint users_organization_id_fkey,
  add constraint users_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table whatsapp_call_sessions
  drop constraint whatsapp_call_sessions_organization_id_fkey,
  add constraint whatsapp_call_sessions_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
alter table whatsapp_sessions
  drop constraint whatsapp_sessions_organization_id_fkey,
  add constraint whatsapp_sessions_organization_id_fkey foreign key (organization_id) references organizations (id) on delete cascade;
