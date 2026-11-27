-- O teto diário de saída segue a linha, e não o número dela (revisão fria da 0.50.0,
-- docs/fundacao/revisao-fria-2026-11-26.md, seção 5). Antes, a contagem do dia filtrava por
-- `from_e164`, e o número da linha é editável: trocar o número devolvia ligações ao teto.
--
-- `calls.trunk_id` é a linha por onde a ligação de saída saiu. Só a ligação de saída o grava
-- (`apps/voice/src/outbound.ts`). Nulo na recebida, e na de saída quando a linha foi apagada.
alter table calls add column trunk_id uuid;
alter table calls
  add foreign key (organization_id, trunk_id) references trunks (organization_id, id) on delete set null (trunk_id);
create index calls_outbound_trunk_started_idx on calls (organization_id, trunk_id, started_at) where direction = 'outbound';

-- As ligações de saída que já existem herdam a linha cujo número é hoje o `from_e164` delas,
-- quando só uma linha da organização tem esse número. Quem já instalou não perde a contagem do dia.
update calls c
   set trunk_id = t.id
  from trunks t
 where c.direction = 'outbound'
   and c.trunk_id is null
   and t.organization_id = c.organization_id
   and t.caller_id_e164 = c.from_e164
   and (select count(*) from trunks o where o.organization_id = c.organization_id and o.caller_id_e164 = c.from_e164) = 1;
