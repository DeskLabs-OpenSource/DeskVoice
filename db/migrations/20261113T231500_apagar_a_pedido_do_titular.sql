-- Apagamento a pedido do titular (LGPD art. 18, VI): o conteúdo sai, a chamada fica.
-- Horário, duração, custo e desfecho não são fala de ninguém: são o registro do serviço prestado e
-- é o que sustenta fatura e relatório. `erased_at` é a marca-cadeado: chamada já apagada não é
-- reescrita nem recontada numa segunda execução do mesmo pedido.
alter table calls add column erased_at timestamptz;

comment on column calls.erased_at is 'Quando o conteúdo desta chamada saiu a pedido do titular; null = nunca saiu.';

-- Todo pedido de titular começa pelo telefone. Sem índice, a busca por número varre a tabela.
create index calls_from_idx on calls (organization_id, from_e164) where from_e164 is not null;
create index calls_to_idx on calls (organization_id, to_e164) where to_e164 is not null;
