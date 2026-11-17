-- Nomes e termos que o agente deve esperar ouvir na ligação ("Melgaço", o nome da empresa, um
-- produto). Vão aos provedores como dica de reconhecimento. A regra de cada termo mora em
-- `packages/core/src/vocabulary.ts`; o banco só guarda a lista.
-- Padrão vazio: quem já instalou não faz nada, e agente sem termos envia ao provedor o mesmo de antes.
alter table agents
  add column vocabulary text[] not null default '{}';
