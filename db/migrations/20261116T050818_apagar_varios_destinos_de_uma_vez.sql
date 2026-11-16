-- Apagar dois destinos numa instrução só não recusa mais a limpeza (ressalva do #306, fatia 4c do
-- desenho de 13/11; registro 0020).
--
-- O gatilho de limpeza (`agents_handoff_targets_cleanup`, de 20261116T032848) roda depois de cada
-- linha apagada, mas, numa instrução que apaga várias, todas já saíram quando ele roda. Com A
-- passando para [B, C] e `delete from agents where id in (B, C)`, a limpeza de B deixava [C] na lista
-- de A, e o gatilho de checagem recusava com `check_violation`, porque C também já não existe. Agora
-- a limpeza tira da lista, de uma vez, todo destino que não existe mais na organização: na volta de
-- C, A já não o tem, e nada mais é atualizado. A ordem dos que ficam não muda.
--
-- Nenhum caminho do produto apaga dois agentes numa instrução; o conserto cobre o caminho de sistema
-- e quem mexer no banco à mão. O gatilho e o de checagem não mudam.
create or replace function agents_remove_deleted_handoff_target() returns trigger language plpgsql as $$
begin
  update agents a
     set agent_handoff_targets = array(
           select t.target from unnest(a.agent_handoff_targets) with ordinality as t(target, position)
            where t.target <> old.id
              and exists (select 1 from agents b where b.id = t.target and b.organization_id = a.organization_id)
            order by t.position
         )
   where a.organization_id = old.organization_id
     and old.id = any(a.agent_handoff_targets);
  return null;
end;
$$;
