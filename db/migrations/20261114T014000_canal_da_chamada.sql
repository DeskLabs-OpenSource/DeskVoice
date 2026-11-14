-- Por onde a chamada chegou: linha telefônica, navegador (chamada pelo painel), WhatsApp ou a chamada
-- simulada que o painel pede pelo botão da tela de Chamadas.
-- Até aqui o canal só existia no evento `call_started` (e no `call_refused` e no `call_ended` de
-- quem nem chegou a conversar), e a lista de Chamadas não tinha como mostrá-lo.
alter table calls
  add column channel text not null default 'phone' check (channel in ('phone', 'web', 'whatsapp', 'simulated'));

-- As chamadas que já existem herdam o canal que o evento registrou.
update calls c
   set channel = e.channel
  from (
    select distinct on (call_id) call_id, payload->>'channel' as channel
      from call_events
     where kind in ('call_started', 'call_ended', 'call_refused')
       and payload->>'channel' in ('web', 'whatsapp')
     order by call_id, id
  ) e
 where e.call_id = c.id;

-- A simulada não registrava canal: é a que tem motor simulado e nenhum número chamado. Uma ligação
-- da linha sempre tem o número chamado, mesmo quando o agente usa o motor simulado.
update calls set channel = 'simulated' where channel = 'phone' and engine = 'simulated' and to_e164 is null;

-- Sem padrão daqui em diante: quem cria uma chamada diz por onde ela chegou, e um caminho novo que
-- esquecer falha no primeiro teste, em vez de virar linha telefônica calado.
alter table calls alter column channel drop default;
