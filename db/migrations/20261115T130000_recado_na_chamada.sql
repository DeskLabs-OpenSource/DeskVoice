-- A chamada atendida pela caixa postal (decisão 0018). O recado tem teto próprio de simultâneas e
-- não ocupa a vaga de uma conversa (escolha 3A), e a contagem do teto precisa separar um do outro
-- na própria linha da chamada: o motivo do recado só existe nos eventos, que nascem depois.
-- As chamadas que já existem são todas conversas ou recusas.
alter table calls add column voicemail boolean not null default false;
