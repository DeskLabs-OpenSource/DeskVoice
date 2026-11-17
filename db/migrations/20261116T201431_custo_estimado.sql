-- O custo estimado no extrato (R12, fatia 7a). `cost_estimated = true` marca a linha cujo custo é
-- uma estimativa: o pedido ao modelo de decisão saiu e o consumo não foi lido (o prazo venceu, a
-- rede caiu, ou a resposta veio fora da forma). A estimativa é gravada e conta no total e no teto,
-- ao contrário de `cost_measured = false`, que é custo zero fora do teto. Só para a frente: toda
-- linha que já existe, e toda linha da voz, fica `false`, que é o que era: custo medido.
alter table usage_ledger
  add column cost_estimated boolean not null default false;
