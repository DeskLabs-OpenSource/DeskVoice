-- O que acontece quando a ligação cai, por agente (desenho 2026-11-16-follow-up-da-ligacao-que-caiu,
-- seção 3.2, fatia 1). `off` é o de hoje: o supervisor abre a pendência quando o motor cai (caso 1) e
-- não faz nada quando quem ligou desliga com a vez aberta. `task` abre a pendência nos dois casos.
-- Os quatro valores já ficam no check; `whatsapp` e `call_back` só passam a valer nas fatias 2 a 4,
-- e até lá a rota do painel recusa os dois.
-- Padrão `off`: quem já instalou não faz nada, e nada muda.
alter table agents
  add column drop_follow_up text not null default 'off'
    check (drop_follow_up in ('off', 'task', 'whatsapp', 'call_back'));
