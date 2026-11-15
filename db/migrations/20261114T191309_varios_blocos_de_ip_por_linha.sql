-- Uma operadora que reconhece a linha pelo endereço de origem pode entregar a ligação a partir de
-- mais de um bloco, um por região (a Twilio publica oito /30 e manda liberar todos). O `host`
-- continua sendo o endereço principal; `match_extra` é a lista dos outros e nasce vazia, então a
-- linha antiga se comporta como antes. `outbound_host` é o destino das ligações de saída quando ele
-- difere do `host` (a Twilio atende pelo nome `<conta>.pstn.twilio.com`, que não é o endereço de
-- origem): nulo, vale o `host`, como hoje. Só `outbound_host` aceita nome: é saída e não entra no
-- `identify`, que só leva endereço numérico.
alter table trunks
  add column match_extra text[] not null default '{}',
  add column outbound_host text;
