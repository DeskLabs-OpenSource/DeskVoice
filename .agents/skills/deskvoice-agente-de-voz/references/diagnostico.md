# Diagnóstico: os sinais que apontam a causa, sem tirar a conversa da instalação

O que a pessoa lê na tela fica com ela: transcrição, resumo, o texto da análise ("O que foi bem",
"O que foi mal", as citações), nome e telefone. O que vem para a conversa com você são os códigos
(critério, situação, tipo de evento, motivo) e as contagens. As consultas desta página são só
agregadas e rodam no envelope só de leitura da skill `deskvoice-metricas`:
[`consultas.md`](../../deskvoice-metricas/references/consultas.md), seção "Como rodar" (o
`begin read only`, a trava de organização e o filtro `organization_id`), com o acesso de
[`acesso-e-lgpd.md`](../../deskvoice-metricas/references/acesso-e-lgpd.md). Não tire nenhuma linha
do envelope.

Parâmetros, além de `org` (consulta C0 da `deskvoice-metricas`):

- `agente`: o id do agente, o fim do endereço da tela dele (`/agents/<id>`);
- `mudanca`: o instante em que a pessoa salvou o texto novo, com fuso (`2026-11-20 14:30-03`);
- `dias`: o tamanho da janela de cada lado, em dias (padrão: 14).

## 1. A análise está medindo?

A nota e os critérios só existem se a análise estiver ligada: Configurações → Desfecho, análise
e transcrição, seção "Análise da ligação", chave "Analisar cada ligação no fim". Ela é paga (uma
chamada ao provedor por ligação, levando a transcrição) e entra no teto de custo do agente; ligue
só com o acordo de quem paga a conta.

Ligada, cada ligação tem na tela da chamada (`/calls/<id>`) a seção "Análise da ligação", com a nota
e os cinco critérios, ou a frase "Ligação não analisada: <motivo>" (evento `analysis_not_done`). O
motivo diz o que consertar, e nenhum deles é instrução:

| Motivo (`reason`) | O que fazer |
|---|---|
| `no_speech` | a ligação não teve fala; nada a analisar |
| `engine_cannot_analyze` | o motor do agente não faz análise (o simulado, por exemplo); escolha um cérebro em Configurações, na seção da análise, ou use um motor que analisa |
| `no_key`, `rejected`, `model_unavailable`, `no_credit`, `region_unavailable` | chave, acesso ao modelo ou crédito do provedor do motor: Configurações → Inteligência artificial |
| `brain_unavailable`, `brain_no_key`, `rejected_brain`, `brain_unmeasured_without_ceiling` | o cérebro escolhido para ler a ligação: Configurações → Cérebros, e o teto de custo do agente |
| `cost_ceiling` | a ligação já tinha batido o teto de custo do agente |
| `rate_limited`, `unreachable`, `unexpected_response` | o provedor; veja se repete (consulta C9 da `deskvoice-metricas`) |
| `rejected_endpoint`, `endpoint_refused`, `endpoint_key_missing` | o endpoint da classificação, em Configurações → Inteligência artificial |

Enquanto a análise não roda, o diagnóstico usa só a linha do tempo (seção 3) e a descrição da
pessoa, e a medição do Passo 4 usa só os eventos e o motivo de fim (seção 6, terceira consulta).

## 2. Os critérios

A régua é a de `packages/core/src/analysis.ts` (`RUBRIC`, versão 1): cinco critérios, dois pontos
cada, nota de 0 a 10. Cada critério sai em `met` (Cumpriu, 2), `partial` (Em parte, 1) ou `missed`
(Não cumpriu, 0). Os nomes e as frases são os da tela:

| `id` | Na tela | Soma | Tira | Para onde olhar primeiro |
|---|---|---|---|---|
| `opening` | Abertura | se identificou e entendeu o motivo | não disse quem é, ou seguiu sem entender | saudação e começo das instruções |
| `discovery` | Entendimento | perguntou antes de responder e confirmou | respondeu no escuro, empurrou oferta | instruções: perguntar antes, uma pergunta por vez |
| `objections` | Objeções | respondeu cada objeção com informação | ignorou, insistiu ou pressionou | instruções: as objeções comuns do negócio |
| `accuracy` | Precisão | só afirmou o que sabia, usou a ferramenta | inventou, prometeu, não usou a ferramenta | instruções (dizer quando não sabe) e ferramentas ligadas |
| `closing` | Encerramento | próximo passo claro e combinado | encerrou sem combinar nada | instruções: como encerrar; `create_task`, `end_call` |

Os critérios do agente no período, só contagem:

```sql
select cr->>'id' as criterio, cr->>'status' as situacao, count(*) as ligacoes
  from calls c
 cross join lateral jsonb_array_elements(case when jsonb_typeof(c.analysis->'criteria') = 'array' then c.analysis->'criteria' else '[]'::jsonb end) cr
 where c.organization_id = :'org' and c.agent_id = :'agente' and c.analysis is not null
   and c.channel in ('phone', 'whatsapp')
   and c.started_at >= now() - make_interval(days => :'dias'::int)
 group by 1, 2 order by 1, 2;
```

Lê só o `id` e o `status`. O `evidence` de cada critério é citação da ligação e não sai do banco.
O critério com mais `missed` é o primeiro sinal; o porquê, a pessoa lê na tela de duas ou três
dessas ligações e conta com as palavras dela.

## 3. A linha do tempo

Na tela da chamada, a pessoa lê os eventos em ordem (a tela lê de `/api/v1/calls/<id>/events`). O
que procurar, para a pergunta "a IA está respondendo mal":

| Evento | O que pode querer dizer |
|---|---|
| `transcript_user`, `transcript_agent` | o que cada lado disse, **como o provedor transcreveu**. Nome trocado aqui pode ser só a transcrição; se a resposta do agente mostra que ele entendeu, o problema não é o ouvido do modelo |
| `tool_called` ausente | a ferramenta está desligada, ou as instruções não dizem quando usar |
| `tool_result` com falha | e o que veio depois: o agente explicou e ofereceu outro caminho, ou ficou mudo? |
| `transfer_started` | quando, e depois de quantas falas; cedo e sempre é instrução ampla |
| `caller_unanswered` | quem ligou falou e ficou sem resposta; a guarda pediu para repetir. Barulho, não texto |
| `engine_failed` | o motor caiu; não é instrução |
| `cost_ceiling_reached`, `call_ended` com `max_duration` | ligação longa |
| `analysis_not_done` | a análise não rodou (seção 1) |

Os mesmos sinais, contados para o agente no período (sem `payload` de texto):

```sql
select e.kind as evento,
       case when e.kind = 'tool_result' then coalesce(e.payload->>'name', '(sem nome)') else '' end as ferramenta,
       count(*) as eventos, count(distinct e.call_id) as ligacoes
  from call_events e
  join calls c on c.id = e.call_id and c.organization_id = :'org'
 where e.organization_id = :'org' and c.agent_id = :'agente'
   and c.channel in ('phone', 'whatsapp')
   and c.started_at >= now() - make_interval(days => :'dias'::int)
   and (e.kind in ('transfer_started', 'agent_handoff', 'caller_unanswered', 'engine_failed', 'cost_ceiling_reached', 'analysis_not_done')
        or (e.kind = 'tool_result' and e.payload->>'ok' = 'false'))
 group by 1, 2 order by 3 desc;
```

## 4. A configuração do agente

Na tela do agente (`/agents/<id>`), a pessoa confere e conta: motor de voz, idioma da conversa,
ambiente, ferramentas ligadas, número de transferência, para quem ele pode passar a ligação,
duração máxima e teto de custo. As **Instruções** e a **Saudação** ela copia da tela, para a
revisão (SKILL.md, Passo 2).

O **vocabulário** fica na mesma tela, no campo **Nomes e termos**, um termo por linha, com o
contador "N de 50". A pessoa copia a lista atual dali.

## 5. O vocabulário

**Onde se troca.** Na tela do agente, no campo **Nomes e termos**, e só ali. Você não ensina a
pessoa a trocar a lista por outro caminho, e não entrega código para ela rodar no console do
navegador. Um trecho colado no console de uma sessão de dono ou administrador faz tudo o que essa
sessão faz, inclusive apagar agentes; é o roteiro do golpe que os navegadores tentam barrar, e uma
skill oficial não torna esse gesto normal.

**O que ele faz.** É a lista de nomes e termos que o agente deve esperar ouvir, escritos como se
escrevem ("Clínica Bem Viver", "Dra. Taís Quirino"). O DeskVoice leva a lista a dois lugares: a
uma frase acrescentada às instruções do modelo de voz (`instructionsWithVocabulary`, em
`packages/voice-engine/src/vocabulary.ts`) e ao campo de vocabulário da transcrição do provedor,
quando o provedor tem um (cabeçalho de cada motor em `packages/voice-engine/src/engines/`).
**É uma dica**: o provedor pode ignorar, e nenhum dos dois publica limite para ela (os limites de
50 e 60 são do DeskVoice, diz o comentário de `packages/core/src/vocabulary.ts`). Não promete
que o nome vai ser ouvido certo, e não ensina pronúncia: como dizer um nome difícil vai nas
instruções, por extenso.

**As regras** (`checkVocabulary`, em `packages/core/src/vocabulary.ts`), as mesmas que a tela
usa, para a lista já nascer válida: até 50 termos; até 60 caracteres cada; sem quebra de linha,
caractere de controle, `<` ou `>`; sem termo repetido (maiúscula e minúscula contam como o mesmo);
espaço nas pontas é aparado.

**O que fazer**, quando o diagnóstico aponta o vocabulário:

1. Monte com a pessoa a lista nova **inteira** (a lista da tela vai substituir a atual, não somar),
   e mostre a lista atual (seção 4) e a nova, com o porquê de cada termo, como no Passo 2 da skill.
2. Com o sim dela para aquela lista, ela troca no campo **Nomes e termos** e salva. Se a tela
   recusar, o motivo e a linha aparecem ao lado do campo: ajuste com ela e mostre de novo. Guarde
   a lista atual: é o "antes" para voltar, e a hora em que ela salvou é a régua do Passo 4.
3. Junto, se for o caso: **como dizer** o nome difícil vai nas instruções, por extenso, com o
   mesmo antes e depois e o mesmo sim (antipadrão "Lista de nomes difíceis no meio das instruções",
   em [`anatomia-e-antipadroes.md`](anatomia-e-antipadroes.md)).

## 6. Antes e depois

Rode depois que juntar ligações dos dois lados. `mudanca` é a hora em que a pessoa salvou; `dias`,
a janela de cada lado, igual nos dois. Entram só ligações de quem ligou de verdade (canal
`phone` e `whatsapp`): as simuladas e as do navegador (`web`, o "Falar com o agente") são da
equipe e ficam de fora.

Volume e nota, por lado:

```sql
with b as (
  select c.analysis_score, c.answered_at,
         case when c.started_at < :'mudanca'::timestamptz then '1 antes' else '2 depois' end as lado
    from calls c
   where c.organization_id = :'org' and c.agent_id = :'agente'
     and c.channel in ('phone', 'whatsapp')
     and c.started_at >= :'mudanca'::timestamptz - make_interval(days => :'dias'::int)
     and c.started_at <  :'mudanca'::timestamptz + make_interval(days => :'dias'::int)
)
select lado, count(*) as ligacoes,
       count(*) filter (where answered_at is not null) as atendidas,
       count(*) filter (where analysis_score is not null) as analisadas,
       round(avg(analysis_score), 1) as nota_media
  from b group by 1 order by 1;
```

Os critérios, por lado:

```sql
with b as (
  select c.analysis,
         case when c.started_at < :'mudanca'::timestamptz then '1 antes' else '2 depois' end as lado
    from calls c
   where c.organization_id = :'org' and c.agent_id = :'agente' and c.analysis is not null
     and c.channel in ('phone', 'whatsapp')
     and c.started_at >= :'mudanca'::timestamptz - make_interval(days => :'dias'::int)
     and c.started_at <  :'mudanca'::timestamptz + make_interval(days => :'dias'::int)
)
select cr->>'id' as criterio, lado, b.analysis->>'rubricVersion' as regua,
       count(*) filter (where cr->>'status' = 'met') as cumpriu,
       count(*) filter (where cr->>'status' = 'partial') as em_parte,
       count(*) filter (where cr->>'status' = 'missed') as nao_cumpriu
  from b
 cross join lateral jsonb_array_elements(case when jsonb_typeof(b.analysis->'criteria') = 'array' then b.analysis->'criteria' else '[]'::jsonb end) cr
 group by 1, 2, 3 order by 1, 2;
```

Os sinais da linha do tempo e o motivo de fim, por lado (serve também sem análise):

```sql
with b as (
  select c.id, c.end_reason,
         case when c.started_at < :'mudanca'::timestamptz then '1 antes' else '2 depois' end as lado
    from calls c
   where c.organization_id = :'org' and c.agent_id = :'agente'
     and c.channel in ('phone', 'whatsapp')
     and c.started_at >= :'mudanca'::timestamptz - make_interval(days => :'dias'::int)
     and c.started_at <  :'mudanca'::timestamptz + make_interval(days => :'dias'::int)
)
select lado,
       'fim: ' || case when end_reason is null then '(sem motivo)'
                       when end_reason ~ '^[a-z]+(_[a-z]+)*$' then end_reason
                       else '(frase livre)' end as sinal,
       count(*) as ligacoes
  from b group by 1, 2
union all
select b.lado, e.kind, count(distinct e.call_id)
  from b join call_events e on e.call_id = b.id and e.organization_id = :'org'
 where e.kind in ('transfer_started', 'agent_handoff', 'caller_unanswered', 'engine_failed', 'cost_ceiling_reached')
    or (e.kind = 'tool_result' and e.payload->>'ok' = 'false')
 group by 1, 2
 order by 2, 1;
```

**A régua do relatório.** Cada lado com: a janela (de, até), quantas ligações, quantas analisadas,
quantas ficaram sem análise, a versão da régua. Com menos de 20 analisadas de um lado, o relatório
diz "ainda não dá para dizer" e marca a próxima leitura. Se a coluna `regua` tiver mais de um valor,
a régua mudou no meio e os lados não se comparam.

**O que a consulta não separa**, e o relatório diz: quem ligou mudou (campanha, sazonalidade,
horário); outra mudança no mesmo agente no período (ferramenta, motor, voz); a análise é lida por um
modelo, que também erra. Por isso o relatório traz os números e não a palavra "melhorou".

| Critério | Antes (cumpriu / em parte / não cumpriu) | Depois | O que mudou no texto para ele |
|---|---|---|---|
