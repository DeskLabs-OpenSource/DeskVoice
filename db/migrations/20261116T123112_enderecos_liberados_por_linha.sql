-- De quais endereços a central aceita a ligação de cada linha (R14, fatia 1). Quem calcula e
-- grava é só o processo de voz: o `host` e os `match_extra` numéricos, e, na linha por registro
-- com nome no `host`, os endereços que o nome resolve. O painel só lê, para mostrar na tela da
-- linha antes de o filtro existir. A linha antiga nasce com a lista vazia e sem hora; o processo
-- de voz preenche na próxima aplicação das linhas (na partida, a mais tardar). Nada aqui muda o
-- que o Asterisk aceita.
alter table trunks
  add column inbound_allowed text[] not null default '{}',
  add column inbound_resolved_at timestamptz;
