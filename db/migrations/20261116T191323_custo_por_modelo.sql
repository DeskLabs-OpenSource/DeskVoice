-- O custo por modelo no extrato (R4, fatia 4a). `model` é o modelo cobrado; fica nulo nas linhas
-- antigas e nas da voz, e nenhuma linha antiga é reescrita. `cost_measured = false` marca a linha
-- cujo preço não era conhecido (modelo sem preço, ou consumo que o provedor não declarou): os
-- tokens ficam, o custo fica zero, e o zero não é confundido com grátis. Tudo o que já existe nasce
-- `true`, que é o que era: custo medido pelo preço de tabela.
alter table usage_ledger
  add column model text,
  add column cost_measured boolean not null default true;
