-- Ficha de um telefone: tudo o que a instalação guarda sobre ele, em NDJSON (uma linha por registro).
--
--   psql -v tel='+5531999998888' -v org= -f db/queries/exportar-ficha.sql
--
-- `org` vazio = todas as organizações. Serve para atender pedido de acesso ou de portabilidade: sai
-- a chamada, os eventos dela (inclusive a transcrição, se ainda não foi expurgada) e a entrada na
-- lista de não ligar. Nada é alterado.
\set ON_ERROR_STOP on

with ficha as (
  select c.started_at as ordem, c.id as chamada,
         jsonb_build_object(
           'tipo', 'chamada',
           'organizacao', c.organization_id,
           'chamada', c.id,
           'direcao', c.direction,
           'de', c.from_e164,
           'para', c.to_e164,
           'situacao', c.status,
           'motivo_do_fim', c.end_reason,
           'motor', c.engine,
           'iniciada_em', c.started_at,
           'atendida_em', c.answered_at,
           'encerrada_em', c.ended_at,
           'custo_centavos', c.cost_cents,
           'resumo', c.summary
         ) as linha
    from calls c
   where :'tel' in (c.from_e164, c.to_e164)
     and (:'org' = '' or c.organization_id = nullif(:'org', '')::uuid)
  union all
  select e.at, e.call_id,
         jsonb_build_object(
           'tipo', 'evento',
           'organizacao', e.organization_id,
           'chamada', e.call_id,
           'quando', e.at,
           'evento', e.kind,
           'conteudo', e.payload
         )
    from call_events e
    join calls c on c.id = e.call_id and c.organization_id = e.organization_id
   where :'tel' in (c.from_e164, c.to_e164)
     and (:'org' = '' or c.organization_id = nullif(:'org', '')::uuid)
  union all
  select d.created_at, null::uuid,
         jsonb_build_object(
           'tipo', 'nao_ligar',
           'organizacao', d.organization_id,
           'telefone', d.e164,
           'motivo', d.reason,
           'desde', d.created_at
         )
    from do_not_call d
   where d.e164 = :'tel'
     and (:'org' = '' or d.organization_id = nullif(:'org', '')::uuid)
)
select linha::text from ficha order by ordem, chamada nulls last, linha;
