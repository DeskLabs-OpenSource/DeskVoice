-- A mensagem no WhatsApp para quem ligou, quando a ligação cai (desenho
-- 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.5, fatia 2).
--
-- O texto é do operador, fixo por agente e sem variável: nada da conversa entra nele, porque o número
-- de quem liga pode não ser de quem ligou. Nulo vale o texto padrão do sistema, na língua do agente.
alter table agents
  add column drop_follow_up_message text
    check (drop_follow_up_message is null or char_length(drop_follow_up_message) between 1 and 300);

-- Separa o aviso à equipe (`team`, todo aviso de antes) da mensagem a quem ligou (`caller`). O
-- apagamento a pedido do titular anula o `target` do aviso `caller`: o número dele não fica guardado.
-- Padrão `team`: os avisos que já existem continuam sendo o que eram.
alter table notifications
  add column audience text not null default 'team'
    check (audience in ('team', 'caller'));
