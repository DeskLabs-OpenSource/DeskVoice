-- Expurgo de transcrição: tira o texto das conversas mais antigas que `dias` e mantém a chamada, o
-- horário e o registro de que houve transcrição. A linha do tempo continua auditável, sem a conversa.
--
--   psql -v dias=90 -v org= -v confirmar=nao -f db/queries/expurgar-transcricoes.sql   (só conta)
--   psql -v dias=90 -v org= -v confirmar=sim -f db/queries/expurgar-transcricoes.sql   (expurga)
--
-- `org` vazio = todas as organizações. Saída: `alvo|expurgadas`, numa linha.
-- Rodar de novo não reconta o que já foi expurgado: o payload expurgado não tem mais `text`.
\set ON_ERROR_STOP on

with alvo as (
  select e.id
    from call_events e
   where e.kind in ('transcript_user', 'transcript_agent')
     and e.payload ? 'text'
     and e.at < now() - make_interval(days => :'dias'::int)
     and (:'org' = '' or e.organization_id = nullif(:'org', '')::uuid)
),
expurgadas as (
  update call_events e
     set payload = jsonb_build_object('expurgado', true)
    from alvo a
   where e.id = a.id
     and :'confirmar' = 'sim'
  returning e.id
)
select (select count(*) from alvo) as alvo, (select count(*) from expurgadas) as expurgadas;
