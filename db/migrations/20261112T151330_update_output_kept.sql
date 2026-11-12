-- O agente guarda no servidor a saída inteira de cada atualização (deploy/agent/last-update.log)
-- e diz no resultado que guardou. A tela só aponta o arquivo quando o agente disse: o agente de uma
-- versão anterior a esta não guarda, e a coluna fica falsa.
alter table update_requests add column output_kept boolean not null default false;
