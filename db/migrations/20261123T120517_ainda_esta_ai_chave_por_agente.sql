-- O "ainda está aí?" quando quem ligou fica calado (Vapi · fatia 9, decisão B do Rafael, 23/11): a
-- guarda vale por agente, com uma chave na tela do agente. Ligada de fábrica para todos, os agentes
-- novos e os que já existem: quem já instalou passa a ter a guarda sem mexer em nada, e o fragmento
-- da versão avisa. Desligada, o agente não pergunta nem encerra, e a ligação calada segue até a
-- duração máxima, como antes.
alter table agents
  add column caller_idle_guard boolean not null default true;
