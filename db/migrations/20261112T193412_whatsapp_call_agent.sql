-- O agente que atende as ligações recebidas pelo WhatsApp no número conectado, escolhido em
-- Configurações. Desenho: docs/specs/2026-11-12-ligacao-pelo-whatsapp.md, seção 5.2.
-- Nulo: ninguém atende, e a ligação segue tocando no celular e nos aparelhos de quem trabalha.
-- Apagar o agente volta a nulo, como o agente de um número da linha telefônica.
alter table whatsapp_call_sessions
  add column agent_id uuid,
  add foreign key (organization_id, agent_id) references agents (organization_id, id) on delete set null (agent_id);
