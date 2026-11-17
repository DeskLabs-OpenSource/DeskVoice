# A régua de cada número, e as armadilhas que distorcem a leitura

Medido no código de `origin/main` em 17/11/2026. Os nomes de tabela e coluna são os de
`db/migrations/`; se uma migration nova mudar algum, vale a migration.

## Período

- A tela Custos recebe `from` e `to` (`AAAA-MM-DD`, **os dois inclusive**), com padrão nos últimos
  30 dias até hoje. As consultas usam a mesma régua: `between :'de'::date and :'ate'::date`.
- Diga sempre o período fechado e com qual período ele foi comparado. Número solto não é análise.

## Fuso

- O dia é o do fuso da organização: `outbound_policy.timezone`, com `America/Sao_Paulo` quando a
  organização não tem política de saída. É o critério de `/api/v1/system/costs`.
- Toda consulta converte com `at time zone`. Comparar um número de consulta com outro em UTC (o
  do servidor) muda a borda do dia.

## Qual carimbo decide o dia

| Número | Carimbo | Observação |
|---|---|---|
| Ligações (C1 a C4, C6, C7, C12) | `calls.started_at` | a ligação conta no dia em que começou |
| Custo por dia, agente e motor na tela | `usage_ledger.at` | a classificação do desfecho pode cair no dia seguinte à ligação |
| Minutos por motor na tela | `calls.ended_at` | a ligação conta inteira no dia em que terminou |
| Eventos (C8 a C10) | `call_events.at` | o dia do acontecimento |
| Tarefas e pendências (C11) | `created_at` | o dia em que nasceram |

Por isso o total da C6 (custo inteiro na ligação, dia de início) pode diferir da tela Custos no
mesmo período. Não é erro: são réguas diferentes, e o relatório diz qual usou.

## Custo

- O extrato (`usage_ledger`) guarda micro-centavos de **dólar** (1 centavo = 1 000 000), porque a
  classificação de uma ligação custa menos de um centavo. Some em micro-centavo e arredonde uma
  vez só, no fim. `usage_ledger.cost_cents` e `calls.cost_cents` são inteiros arredondados: somar
  esses dá outro número.
- `cost_measured = false`: o provedor não informou uso que dê para precificar. O zero dessa linha
  **não é grátis**. Imprima a contagem ao lado da soma, sempre.
- `cost_estimated = true`: o valor entrou por estimativa e fica acima do real.
- É estimativa por preço de tabela. A fatura do provedor é a que vale; a operadora (minuto do
  tronco) e a VPS não entram. A tela e o guia já dizem isso: skill `deskvoice-operar`, seção 5, e
  `docs/guides/custos.md`.
- O agente de cada linha do extrato é `coalesce(l.agent_id, c.agent_id)`: numa ligação passada de um
  agente a outro, cada trecho fica com o seu. Somando as ligações de cada agente, o total pode
  passar do número de ligações.

## Canal de teste

`calls.channel` separa `phone`, `whatsapp`, `web` (a conversa pelo navegador, no painel) e
`simulated` (o botão da tela de Chamadas). As duas últimas são teste da equipe. Separe antes de
falar em "taxa de atendimento".

## Vocabulário fechado e aberto

- Fechados por `check` no banco: `calls.status`, `direction`, `channel`, `outcome`;
  `approvals.status`; `tasks.status`; `follow_ups.status`; `notifications.channel` e `status`.
- Fechado no código: `call_events.kind` (`CALL_EVENT_KINDS` em `packages/core/src/types.ts`).
- **Aberto**: `calls.end_reason` (a ferramenta `end_call` grava a frase do agente), `tasks.kind`,
  `usage_ledger.engine` e `model`. Um `group by` pode trazer valor fora de qualquer lista: mostre
  como está, sem "corrigir", e nunca a frase livre (a C3 a troca por `(frase livre)`).
- A frase de cada código de fim, recusa ou falha está em `apps/panel/src/i18n/pt-BR/timeline.ts`.

## `null` não é zero

- `outcome` nulo: não foi atendida, o desfecho está desligado, ou tentou e não classificou (C9
  diz por quê). "Sem desfecho" não é "desfecho ruim".
- `analysis_score` nulo: a análise não rodou. Média de nota só sobre as analisadas, e com quantas
  foram ao lado.
- Mediana nula na C1: não houve ligação atendida e terminada no grupo.

## A análise muda de régua

A nota sai da rubrica de `packages/core/src/analysis.ts` (`RUBRIC`, `RUBRIC_VERSION`). Cada análise
guarda a versão em `analysis->>'rubricVersion'`. Comparar períodos com versões diferentes é
comparar réguas diferentes: confira antes.

## A tela corta, a consulta não

`/api/v1/calls` devolve só as **200 chamadas mais recentes**. Contar pela tela de Chamadas numa
organização com mais que isso dá número menor. Para contar, a consulta.

## Números que dependem do "agora"

`atrasadas_agora` (C11), `vencidas_agora` (C11) e `ligadas_hoje` (C12) dependem da hora em que a
consulta roda. Anote a hora no relatório. A linha "rotinas" da tela Saúde diz se a fila está
atrasada ou parada agora (`routines_late`, `routines_stuck`): olhe-a antes de concluir que a tarefa
"não funciona".

## Pouco dado

Uma semana ou poucas dezenas de ligações não sustentam tendência. Diga que é cedo e quando voltar a
medir.
