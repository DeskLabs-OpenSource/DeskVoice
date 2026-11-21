-- Se ninguém atender a transferência para uma pessoa, a ligação volta para o agente (Vapi · fatia 5a,
-- decisão DESA-316, item 5: A). Ligada de fábrica para todos, os agentes novos e os que já existem:
-- quem já instalou passa a ter a volta sem mexer em nada, e o fragmento da versão avisa. Desligada, a
-- ligação desliga como antes, com o aviso "retorne a ligação" no painel.
alter table agents
  add column transfer_returns_to_agent boolean not null default true;
