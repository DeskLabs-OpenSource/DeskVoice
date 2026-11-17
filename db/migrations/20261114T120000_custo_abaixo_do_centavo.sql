-- O custo abaixo do centavo, no extrato. `cost_cents` é centavo inteiro, e uma classificação de
-- ligação custa cerca de 0,03 centavo: arredondada sozinha, ela virava 1 centavo — trinta vezes o
-- valor de tabela — e a soma do mês era uma ficção.
--
-- `cost_microcents` guarda o custo exato de cada linha em micro-centavos (1 centavo = 1 000 000 µ¢).
-- O micro-centavo é a menor unidade que o preço em uso pede: um token de entrada do `gpt-5-nano`
-- custa 5 µ¢, então nenhum token se perde. `cost_cents` continua sendo a vista arredondada da
-- linha, e quem soma usa o micro-centavo e arredonda uma vez só, no total.
--
-- O que já está gravado é centavo inteiro: o micro-centavo dele é o próprio valor vezes um milhão.
alter table usage_ledger
  add column cost_microcents bigint not null default 0 check (cost_microcents >= 0);

update usage_ledger set cost_microcents = cost_cents::bigint * 1000000;

comment on column usage_ledger.cost_microcents is
  'Custo exato da linha em micro-centavos (1 centavo = 1000000). A coluna cost_cents é esta, arredondada.';
