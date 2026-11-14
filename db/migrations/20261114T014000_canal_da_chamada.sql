-- Por onde a chamada chegou: linha telefônica, navegador (chamada pelo painel) ou WhatsApp.
-- Até aqui o canal só existia no evento `call_started` (e no `call_refused` e no `call_ended` de
-- quem nem chegou a conversar), e a lista de Chamadas não tinha como mostrá-lo.
alter table calls
  add column channel text not null default 'phone' check (channel in ('phone', 'web', 'whatsapp'));

-- As chamadas que já existem herdam o canal que o evento registrou. Sem evento com canal, é linha.
update calls c
   set channel = e.channel
  from (
    select distinct on (call_id) call_id, payload->>'channel' as channel
      from call_events
     where payload->>'channel' in ('web', 'whatsapp')
     order by call_id, id
  ) e
 where e.call_id = c.id;
