-- Passagem da ligação entre agentes, fatia 4a do desenho de 13/11
-- (docs/specs/2026-11-13-equipe-de-agentes-e-memoria.md, seções 4.2 e 4.3; registro 0020).
--
-- `agent_handoff_targets`: para quem o agente pode passar a ligação. Vazia de fábrica: sem destino,
-- a ferramenta `transfer_to_agent` não aparece para o modelo, e quem já instalou não vê nada mudar.
-- Lista de ids, e não tabela própria, porque o desenho fala de uma lista de marcar por agente; a
-- regra da organização vale aqui, na escrita (o gatilho abaixo), e de novo na leitura, no processo
-- de voz, por `withOrg`.
alter table agents
  add column agent_handoff_targets uuid[] not null default '{}';

-- Um destino precisa ser um agente da mesma organização. Vale para todo caminho de escrita, inclusive
-- o de sistema, que não passa pelo isolamento por linha: a organização é conferida pelo nome.
-- O agente apagado depois continua na lista de quem o tinha; a leitura o ignora.
create function agents_check_handoff_targets() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from unnest(new.agent_handoff_targets) as target(id)
     where not exists (select 1 from agents a where a.id = target.id and a.organization_id = new.organization_id)
  ) then
    raise exception 'agent_handoff_targets: every target must be an agent of the same organization'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger agents_handoff_targets_check
  before insert or update of agent_handoff_targets on agents
  for each row when (cardinality(new.agent_handoff_targets) > 0)
  execute function agents_check_handoff_targets();

-- Em que agente a ligação estava quando o uso foi medido. Com passagem, o custo de cada trecho fica
-- com o agente dele, e não todo com o que atendeu. As linhas antigas ficam nulas: não há como saber
-- o agente de cada uma sem adivinhar, e antes desta mudança a ligação nunca trocava de agente.
alter table usage_ledger
  add column agent_id uuid,
  add foreign key (organization_id, agent_id) references agents (organization_id, id) on delete set null (agent_id);
create index usage_ledger_agent_idx on usage_ledger (organization_id, agent_id);
