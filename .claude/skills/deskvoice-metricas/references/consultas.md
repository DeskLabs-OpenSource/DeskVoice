# Consultas prontas: agregadas, só leitura, filtradas pela organização

Antes de rodar qualquer uma, leia [`acesso-e-lgpd.md`](acesso-e-lgpd.md) (como entrar no banco e o
que nunca sai dele) e [`regua-e-armadilhas.md`](regua-e-armadilhas.md) (o que cada número quer
dizer).

## Como rodar

Parâmetros do `psql`: `org` (o id da organização, da consulta C0), `de` e `ate` (dias no formato
`AAAA-MM-DD`, **os dois inclusive**, no fuso da organização: a mesma régua da tela de Custos).

Cada consulta vai num arquivo `.sql` dentro deste envelope, sem tirar nenhuma linha dele:

```sql
begin read only;
set local role deskvoice_app;
select set_config('app.organization_id', :'org', true);

-- a consulta aqui

rollback;
```

- `begin read only`: o banco recusa qualquer escrita dentro da transação.
- `set local role deskvoice_app` com `app.organization_id`: a mesma trava de organização que o
  produto usa (`withOrg`). Uma linha de outra organização não passa nem se o filtro faltar.
- O filtro `organization_id = :'org'` continua em **toda** tabela de toda consulta. As duas travas
  são de propósito: a do papel protege do erro de digitação, a do filtro protege quando alguém
  roda a consulta fora do envelope.
- `rollback` no fim: nada fica aberto.

O fuso de cada consulta é o da política de saída da organização (`outbound_policy.timezone`), com
`America/Sao_Paulo` quando ela não tem política: o mesmo critério de `/api/v1/system/costs`.

Toda consulta abaixo foi rodada no banco de teste antes de entrar aqui; a saída está no PR que a
trouxe. Consulta nova segue o mesmo caminho: banco de teste, depois a instalação.

## C0: achar o id da organização

O endereço de uma chamada no painel termina no id dela (`/calls/<id>`). Abra qualquer chamada da
organização e use esse id:

```sql
select organization_id from calls where id = :'chamada';
```

É a única consulta sem o filtro de organização, porque é ela que descobre o filtro. Roda fora do
envelope (ainda sem `org`), mas em transação só de leitura: `begin read only;` antes e
`rollback;` depois. Devolve um id e mais nada.

## Panorama (rode sempre, antes de aprofundar)

### C1: ligações por dia, direção e canal

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select to_char((c.started_at at time zone z.zone)::date, 'YYYY-MM-DD') as dia,
       c.direction as direcao, c.channel as canal,
       count(*) as ligacoes,
       count(*) filter (where c.answered_at is not null) as atendidas,
       count(*) filter (where c.status = 'refused') as recusadas,
       count(*) filter (where c.status = 'transferred') as transferidas,
       count(*) filter (where c.status = 'failed') as falharam,
       round((percentile_cont(0.5) within group (order by extract(epoch from (c.ended_at - c.answered_at)))
              filter (where c.answered_at is not null and c.ended_at is not null))::numeric) as segundos_atendida_p50
  from calls c cross join z
 where c.organization_id = :'org'
   and (c.started_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1, 2, 3 order by 1, 2, 3;
```

Régua: a ligação conta no dia em que **começou**. `canal` separa linha (`phone`), WhatsApp,
navegador (`web`, a conversa pelo painel) e simulada (`simulated`, o botão da tela de Chamadas):
as duas últimas são teste da equipe, e somá-las com as de verdade engana. A mediana de duração
conta só a ligação atendida e terminada.

### C2: quando as pessoas ligam (dia da semana × hora)

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select extract(isodow from (c.started_at at time zone z.zone))::int as dia_semana,
       extract(hour from (c.started_at at time zone z.zone))::int as hora,
       count(*) as ligacoes,
       count(*) filter (where c.answered_at is null) as sem_atender
  from calls c cross join z
 where c.organization_id = :'org' and c.direction = 'inbound' and c.channel in ('phone', 'whatsapp')
   and (c.started_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1, 2 order by 1, 2;
```

Régua: só entrada, só linha e WhatsApp. `dia_semana` vai de 1 (segunda) a 7 (domingo).

### C3: como as ligações terminaram

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select c.status,
       case when c.end_reason is null then '(sem motivo)'
            when c.end_reason ~ '^[a-z]+(_[a-z]+)*$' then c.end_reason
            else '(frase livre)' end as motivo,
       count(*) as ligacoes
  from calls c cross join z
 where c.organization_id = :'org'
   and (c.started_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1, 2 order by 3 desc;
```

Régua: `end_reason` é código. Todo ponto de escrita grava um código (a ferramenta `end_call`
grava `end_call`; o motivo que o agente escreve fica nos `args` do `tool_called`), e a cerca
`call-end-reasons-have-a-sentence` exige uma frase no dicionário para cada um. A troca por
`(frase livre)` é defesa: se algo fora da forma de código chegar por outro caminho, não sai do banco. A frase de cada código está em
`apps/panel/src/i18n/pt-BR/timeline.ts`.

### C4: desfecho das ligações

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select coalesce(c.outcome, '(sem desfecho)') as desfecho,
       count(*) as ligacoes,
       count(*) filter (where c.answered_at is not null) as atendidas,
       round(avg(c.outcome_confidence), 2) as confianca_media
  from calls c cross join z
 where c.organization_id = :'org'
   and (c.started_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1 order by 2 desc;
```

Régua: toda ligação do período. `(sem desfecho)` junta a ligação que não foi atendida (compare
`ligacoes` com `atendidas`), o desfecho desligado em Configurações → Desfecho, análise e transcrição e o
desfecho que tentou e não classificou: a C9 separa este último. Taxa de desfecho se calcula sobre
`atendidas`, nunca sobre `ligacoes`.

### C5: custo por motor e modelo

Para o total, por dia, por agente e por motor, **use a tela Custos** (skill `deskvoice-operar`,
seção 5): ela já soma do jeito certo. Esta consulta só acrescenta o que a tela não abre, o modelo:

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select l.engine as motor, coalesce(l.model, '(sem modelo)') as modelo,
       count(*) as linhas_do_extrato,
       count(distinct l.call_id) as ligacoes,
       round(sum(l.cost_microcents) / 1000000.0, 4) as centavos_de_dolar,
       count(*) filter (where not l.cost_measured) as sem_custo_medido,
       count(*) filter (where l.cost_estimated) as com_custo_estimado
  from usage_ledger l cross join z
 where l.organization_id = :'org'
   and (l.at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1, 2 order by 5 desc nulls last;
```

Régua: o dia é o da linha do extrato (`usage_ledger.at`), como na tela. Valor em centavos de
**dólar**, a partir do micro-centavo (1 centavo = 1 000 000). `sem_custo_medido > 0` quer dizer
que o zero daquela linha não é grátis; `com_custo_estimado > 0`, que o valor inclui estimativa.

### C6: custo por desfecho

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone),
     custo as (select l.call_id, sum(l.cost_microcents) as micro,
                      bool_or(not l.cost_measured) as falta_medir
                 from usage_ledger l where l.organization_id = :'org' group by 1)
select coalesce(c.outcome, '(sem desfecho)') as desfecho,
       count(*) as ligacoes,
       count(*) filter (where c.answered_at is not null) as atendidas,
       round(sum(coalesce(k.micro, 0)) / 1000000.0, 2) as centavos_de_dolar,
       round(sum(coalesce(k.micro, 0)) / 1000000.0 / nullif(count(*), 0), 2) as centavos_por_ligacao,
       count(*) filter (where k.falta_medir) as ligacoes_com_custo_nao_medido
  from calls c cross join z left join custo k on k.call_id = c.id
 where c.organization_id = :'org'
   and (c.started_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1 order by 2 desc;
```

Régua: aqui o custo entra **inteiro na ligação**, no dia em que ela começou, e não no dia da linha
do extrato. Por isso o total pode diferir da tela Custos no mesmo período (a classificação do
desfecho às vezes cai no dia seguinte). Diga isso ao lado do número.

## Aprofundar

### C7: nota da análise, por agente e por critério

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select coalesce(a.name, '(agente apagado)') as agente,
       count(*) filter (where c.answered_at is not null) as atendidas,
       count(*) filter (where c.analysis_score is not null) as analisadas,
       round(avg(c.analysis_score), 1) as nota_media,
       percentile_cont(0.5) within group (order by c.analysis_score) filter (where c.analysis_score is not null) as nota_p50
  from calls c cross join z
  left join agents a on a.id = c.agent_id and a.organization_id = :'org'
 where c.organization_id = :'org'
   and (c.started_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1 order by 2 desc;
```

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select cr->>'id' as criterio, cr->>'status' as situacao, count(*) as ligacoes
  from calls c cross join z
 cross join lateral jsonb_array_elements(case when jsonb_typeof(c.analysis->'criteria') = 'array' then c.analysis->'criteria' else '[]'::jsonb end) cr
 where c.organization_id = :'org' and c.analysis is not null
   and (c.started_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1, 2 order by 1, 2;
```

Régua: nota de 0 a 10, pela rubrica de `packages/core/src/analysis.ts` (`RUBRIC`, cinco critérios
de dois pontos). Lê só o `id` e o `status` de cada critério. O campo `evidence` é citação da
ligação, e o resto da análise (`strengths`, `weaknesses`, `objections`, `nextStep`) é texto: nunca
saem do banco. A nota de uma ligação está na tela da chamada; esta consulta só junta.

### C8: passagem de bastão (transferência, passagem entre agentes, aprovação)

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select e.kind as evento, count(*) as eventos, count(distinct e.call_id) as ligacoes
  from call_events e cross join z
 where e.organization_id = :'org'
   and e.kind in ('transfer_started', 'transfer_completed', 'agent_handoff', 'approval_requested', 'approval_decided', 'human_notified')
   and (e.at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1 order by 1;
```

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select p.status as situacao, count(*) as pedidos,
       round((percentile_cont(0.5) within group (order by extract(epoch from (p.decided_at - r.at)) / 60)
              filter (where p.decided_at is not null))::numeric, 1) as minutos_ate_decidir_p50
  from approvals p
  join lateral (select min(e.at) as at from call_events e
                 where e.organization_id = :'org' and e.call_id = p.call_id and e.kind = 'approval_requested'
                   and e.payload->>'approvalId' = p.id::text) r on true
  cross join z
 where p.organization_id = :'org'
   and (r.at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1 order by 2 desc;
```

Régua: evento conta no dia em que aconteceu. Aprovação conta no dia em que foi pedida; `expired`
é o prazo que venceu sem ninguém decidir (valeu o padrão do pedido). A pergunta e o contexto do
pedido (`question`, `context`) são texto e não saem.

### C9: o que não foi medido (desfecho, análise, transcrição)

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select e.kind as evento, coalesce(e.payload->>'reason', '(sem motivo)') as motivo, count(*) as eventos
  from call_events e cross join z
 where e.organization_id = :'org'
   and e.kind in ('outcome_not_classified', 'analysis_not_done', 'transcription_failed')
   and (e.at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1, 2 order by 1, 3 desc;
```

Régua: `reason` desses três eventos é código (`no_credit`, `brain_unavailable`, `cost_ceiling`…);
a frase de cada um está no dicionário da linha do tempo.

### C10: falhas que a pessoa na linha sentiu

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select e.kind as evento,
       case when e.kind = 'call_refused' then coalesce(e.payload->>'reason', '(sem motivo)')
            when e.kind = 'engine_failed' then coalesce(e.payload->>'engine', '(sem motor)')
            when e.kind = 'tool_result' then coalesce(e.payload->>'name', '(sem nome)')
            else '' end as detalhe,
       count(*) as eventos, count(distinct e.call_id) as ligacoes
  from call_events e cross join z
 where e.organization_id = :'org'
   and (e.kind in ('engine_failed', 'call_refused', 'cost_ceiling_reached', 'voicemail_failed', 'recording_failed', 'caller_unanswered')
        or (e.kind = 'tool_result' and e.payload->>'ok' = 'false'))
   and (e.at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1, 2 order by 3 desc;
```

Régua: `tool_result` entra só quando falhou, pelo nome da ferramenta. A mensagem de erro
(`error`, `message`, `detail`) fica no banco: pode trazer o que a pessoa disse ou o retorno de um
serviço de fora. Para ler uma falha, abra a chamada na tela.

### C11: o trabalho depois da ligação (fila e pendências)

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select t.kind as tarefa, t.status as situacao, count(*) as tarefas,
       max(t.attempts) as tentativas_max,
       count(*) filter (where t.status = 'queued' and t.run_at < now() - interval '15 minutes') as atrasadas_agora
  from tasks t cross join z
 where t.organization_id = :'org'
   and (t.created_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1, 2 order by 1, 2;
```

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone)
select f.status as situacao, count(*) as pendencias,
       count(*) filter (where f.status = 'open' and f.due_at < now()) as vencidas_agora,
       count(*) filter (where f.owner_user_id is null) as sem_responsavel,
       round((percentile_cont(0.5) within group (order by extract(epoch from (f.closed_at - f.created_at)) / 3600)
              filter (where f.closed_at is not null))::numeric, 1) as horas_ate_fechar_p50
  from follow_ups f cross join z
 where f.organization_id = :'org'
   and (f.created_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1 order by 2 desc;
```

Régua: tarefa e pendência contam no dia em que nasceram. `atrasadas_agora` e `vencidas_agora`
dependem da hora em que a consulta roda: anote a hora no relatório. O erro da tarefa
(`last_error`), o título, o detalhe e a nota de fechamento da pendência são texto e não saem.

### C12: ligações de saída contra o teto

```sql
with z as (select coalesce((select timezone from outbound_policy where organization_id = :'org'), 'America/Sao_Paulo') as zone),
     p as (select daily_cap_per_line, enabled from outbound_policy where organization_id = :'org')
select to_char((c.started_at at time zone z.zone)::date, 'YYYY-MM-DD') as dia,
       count(*) as tentativas,
       count(*) filter (where c.answered_at is not null) as atendidas,
       count(*) filter (where c.status = 'refused') as recusadas,
       count(distinct c.from_e164) as linhas_usadas,
       (select daily_cap_per_line from p) as teto_por_linha,
       (select enabled from p) as ligadas_hoje
  from calls c cross join z
 where c.organization_id = :'org' and c.direction = 'outbound'
   and (c.started_at at time zone z.zone)::date between :'de'::date and :'ate'::date
 group by 1 order by 1;
```

Régua: o teto é **por linha**, por dia, no fuso da política; `linhas_usadas` só conta, não mostra
o número. O motivo de cada recusa sai na C10 (`call_refused`). `ligadas_hoje` é o estado de agora,
não o do dia da linha.
