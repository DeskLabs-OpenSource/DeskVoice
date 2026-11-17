-- Apagar um agente tira o id dele da lista de destinos dos outros (fatia 4b do desenho de 13/11,
-- seção 4.2; registro 0020).
--
-- Sem isto, o id apagado ficava na lista de quem o tinha, e o gatilho `agents_handoff_targets_check`
-- recusava qualquer edição desse agente, até a do nome, com `check_violation`. A lista fica sem
-- lixo, e a tela não precisa esconder agente que não existe. O gatilho de checagem não muda.
--
-- Roda com o papel de quem apaga, dentro do mesmo `withOrg`: o isolamento por linha deixa atualizar
-- as linhas da organização do agente apagado, e o `where` filtra a organização mesmo assim.
create function agents_remove_deleted_handoff_target() returns trigger language plpgsql as $$
begin
  update agents
     set agent_handoff_targets = array_remove(agent_handoff_targets, old.id)
   where organization_id = old.organization_id
     and old.id = any(agent_handoff_targets);
  return null;
end;
$$;

create trigger agents_handoff_targets_cleanup
  after delete on agents
  for each row execute function agents_remove_deleted_handoff_target();

-- Os ids que já não existem, deixados por apagamentos de antes desta mudança. Sem agente apagado
-- nas listas, o gatilho de checagem não tem o que recusar.
update agents a
   set agent_handoff_targets = array(
         select t.target from unnest(a.agent_handoff_targets) with ordinality as t(target, position)
          where exists (select 1 from agents b where b.id = t.target and b.organization_id = a.organization_id)
          order by t.position
       )
 where exists (
   select 1 from unnest(a.agent_handoff_targets) as target
    where not exists (select 1 from agents b where b.id = target and b.organization_id = a.organization_id)
 );
