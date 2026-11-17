-- O que o nome da operadora resolveu, guardado à parte do conjunto liberado da linha (R14, fatia 2,
-- contrato 7). Só essa parte usa a regra do último conjunto quando o DNS falha: o `host` numérico e
-- os `match_extra` saem sempre da linha atual, então um extra removido deixa de ser liberado mesmo
-- com o DNS fora. Quem grava é só o processo de voz; o painel só zera as colunas quando muda o
-- `host` ou o modo da linha.
alter table trunks add column inbound_from_name text[] not null default '{}';
-- Quando cada endereço de `inbound_from_name` veio numa resposta do nome pela última vez (endereço →
-- hora ISO 8601). A parte do nome é a união das respostas das últimas 24 horas, para que um DNS que
-- devolve só uma parte dos endereços a cada consulta não faça o filtro oscilar.
alter table trunks add column inbound_from_name_seen jsonb not null default '{}';
-- Se o filtro de entrada vale para a linha (R14, contrato 11). A linha criada depois desta versão
-- nasce com o filtro ligado, porque quem cadastra vê na tela de onde a central aceita a ligação. Na
-- linha por registro que já existe, ele começa desligado: a operadora que registra por um servidor e
-- entrega por outro seria cortada na atualização. Quem confere a lista liga na tela. A linha por IP
-- liga na hora: ela já só era reconhecida pelo `host` e pelos extras, o mesmo conjunto do filtro.
alter table trunks add column inbound_filter boolean not null default true;
update trunks set inbound_filter = false where auth_mode = 'register';

-- A linha por registro com nome no `host` já tem o conjunto gravado pela fatia 1: o que veio do nome
-- é esse conjunto menos os `match_extra` dela. O conjunto está na forma canônica, mas os extras são
-- gravados como foram digitados (só sem os brancos das bordas: `200.1.002.3`, `10.0.0.5/24`,
-- `::FFFF:1.2.3.4`, `1.2.3.4:5060`). A subtração compara os dois como endereço (`inet`), na forma
-- canônica: a porta e os colchetes saem, o bloco vira a rede dele e o IPv4 escrito como IPv6 mapeado
-- volta a ser IPv4. O que não é endereço não casa com nada (e não derruba a migration).
create function pg_temp.endereco_canonico(value text) returns inet language plpgsql immutable as $$
declare
  text_value text := regexp_replace(lower(btrim(value)), '\.$', '');
  address inet;
begin
  if text_value ~ '^\[[^]]+\](:[0-9]+)?$' then
    text_value := substring(text_value from '^\[([^]]+)\]');
  elsif text_value ~ '^[0-9.]+:[0-9]+$' then
    text_value := split_part(text_value, ':', 1);
  end if;
  address := network(text_value::inet);
  if family(address) = 6 and masklen(address) >= 96 and address <<= '::ffff:0.0.0.0/96'::inet then
    address := network(set_masklen(substring(host(address) from 8)::inet, masklen(address) - 96));
  end if;
  return address;
exception when others then
  return null;
end;
$$;

update trunks t
   set inbound_from_name = array(
         select allowed.address
           from unnest(t.inbound_allowed) with ordinality as allowed(address, position)
          where not exists (
                  select 1 from unnest(t.match_extra) as extra(value)
                   where pg_temp.endereco_canonico(extra.value) = pg_temp.endereco_canonico(allowed.address)
                )
          order by allowed.position
       )
 where t.auth_mode = 'register'
   and pg_temp.endereco_canonico(t.host) is null
   and cardinality(t.inbound_allowed) > 0;

-- O que veio da fatia 1 conta como visto na hora em que foi gravado.
update trunks
   set inbound_from_name_seen = (
         select coalesce(jsonb_object_agg(address, to_char(coalesce(inbound_resolved_at, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), '{}')
           from unnest(inbound_from_name) as address
       )
 where cardinality(inbound_from_name) > 0;

drop function pg_temp.endereco_canonico(text);
