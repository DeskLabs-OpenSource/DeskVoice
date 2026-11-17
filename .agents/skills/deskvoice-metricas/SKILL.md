---
name: deskvoice-metricas
description: 'Ler as métricas de uma instalação do DeskVoice com régua declarada: volume de ligações, horário de pico, como terminaram, desfecho, nota da análise, custo por motor e por desfecho, transferências e aprovações, falhas, fila e pendências, ligações de saída contra o teto. Primeiro as telas (Saúde, Custos, Chamadas, a chamada); depois SQL só agregado e só de leitura, filtrado pela organização, sem transcrição, nome ou telefone. Use quando a pessoa perguntar "como está a operação", "quantas ligações", "o agente está resolvendo?", "por que caiu o atendimento", "que horas mais ligam", "quanto custa cada ligação", "a fila está andando?", ou pedir relatório das ligações. Cada número sai com período, fuso, definição e o que ficou de fora, e termina em ação.'
---

# Ler as métricas de uma instalação

Cada número do DeskVoice tem uma régua: em que dia a ligação conta (a que começou ou a que
terminou), em que fuso, se o zero é zero ou "não medido". Quem soma números de réguas diferentes
chega a uma conclusão errada com cara de precisa. Esta skill lê a fonte, declara a régua ao lado de
cada número e transforma a medida em próximo passo.

## Como você age

- **A pergunta antes da consulta.** "O atendimento caiu?" vira: qual organização, qual período,
  comparado a quê, medido por qual definição.
- **A tela antes do banco.** O que a tela já mostra, a pessoa lê na tela. O banco é para o que a
  tela não abre.
- **Agregado, nunca o texto.** Contagens, medianas, taxas e códigos. Nunca transcrição, resumo,
  nome, telefone, recado, nem o `payload` inteiro de um evento.
  [`references/acesso-e-lgpd.md`](references/acesso-e-lgpd.md) tem a lista do que pode e do que
  nunca sai.
- **Só leitura e só a organização pedida.** Toda consulta roda no envelope de
  [`references/consultas.md`](references/consultas.md) (`begin read only`, a trava de organização)
  e filtra `organization_id`.
- **Régua ao lado do número:** período fechado, fuso (o da `outbound_policy` da organização, como a
  tela Custos), definição (qual tabela, qual filtro) e o que ficou de fora (canal de teste, custo
  não medido, ligação sem desfecho).
- **`null` não é zero**, e "não medido" não é grátis.
- **Termine em ação.** Cada achado vira hipótese e próximo passo, ou "medir de novo em duas
  semanas".

## Passo 0: a fonte, nesta ordem

1. **A tela Saúde** (`/health`, rota `/api/v1/system/health`). Antes de ler qualquer número,
   confira se a instalação está de pé: uma queda de ligações pode ser o tronco caído, e uma fila
   que "não anda" pode ser a linha "rotinas" em falha.
2. **A tela Custos** (`/costs`, rota `/api/v1/system/costs`). Total, por dia, por agente e por
   motor, com as marcas "não medido" e "inclui estimativa". Como ler e como gastar menos: skill
   `deskvoice-operar`, seção 5. Não repita aqui o que ela ensina.
3. **A tela Chamadas** (`/calls`, rota `/api/v1/calls`): as 200 mais recentes, com situação,
   desfecho e nota. Serve para olhar, não para contar.
4. **A chamada** (`/calls/<id>`): a linha do tempo e a seção da análise de uma ligação. É ali que a
   pessoa lê o porquê de um caso.
5. **O banco**, para o que as telas não somam: [`references/consultas.md`](references/consultas.md).
   Como entrar e o que nunca pedir: [`references/acesso-e-lgpd.md`](references/acesso-e-lgpd.md).

As rotas abrem só com a sessão de quem está logado. Não peça cookie nem senha: peça à pessoa o que a
tela mostra.

## Passo 1: a triagem do pedido

Uma pergunta por vez: qual organização (C0); qual período (padrão: os últimos 30 dias, como a tela
Custos, comparados aos 30 anteriores); o que está incomodando (atende pouco, resolve pouco, custa
caro, falha, a fila não anda). Anote a régua antes de rodar qualquer coisa.

## Passo 2: o panorama, sempre

C1 a C6 de [`references/consultas.md`](references/consultas.md): ligações por dia, direção e canal;
horário de pico; como terminaram; desfecho; custo por motor e modelo; custo por desfecho. Uma tabela
por bloco, com a régua embaixo. Leia [`references/regua-e-armadilhas.md`](references/regua-e-armadilhas.md)
antes de afirmar.

## Passo 3: aprofunde onde dói

| Sintoma | Consultas | O que costuma explicar | Próximo passo |
|---|---|---|---|
| "Atende pouco", "perde ligação" | C1, C2, C3, C10 | recusa por `inbound_limit_reached`, `agent_disabled`, `engine_not_configured`, `no_agent`; pico fora do horário de quem atende | linha e agente: skill `deskvoice-operar`, seções 1 e 2; tronco: skill `deskvoice-instalar` |
| "Resolve pouco", "a IA está respondendo mal" | C4, C7, C9 | critério da rubrica com muito `missed`; desfecho não classificado por chave ou crédito (C9) | a skill que afina o agente de voz ainda não existe (`deskvoice-agente-de-voz`, fatia 5 do kit de skills, desenho no PR #317). Até lá: instruções do agente pela skill `deskvoice-operar`, seção 1, e a linha do tempo de algumas ligações com nota baixa, lidas pela pessoa na tela |
| "Passa tudo para pessoa" | C8 | instrução que manda transferir "na dúvida"; aprovação que expira (`expired`) porque ninguém decide | skill `deskvoice-operar`, seção 4 ("Transferiu sem motivo", "Ficou esperando e desligou") |
| "Custa caro" | tela Custos, C5, C6 | modelo caro no desfecho ou na análise; ligação longa; `sem_custo_medido` escondendo gasto | skill `deskvoice-operar`, seção 5 |
| "Cai no meio", "falha" | C10 | `engine_failed` concentrado num motor; ferramenta sem conector (`tool_result` com `ok` falso) | Saúde; skill `deskvoice-operar`, seção 4; ferramenta: skill `deskvoice-ferramenta` |
| "A fila não anda", "o resumo não chega" | Saúde (linha "rotinas"), C11 | rotinas paradas; tarefa em `failed` | skill `deskvoice-operar`, seção 7 (`bash install/healthcheck.sh`) |
| "As pendências acumulam" | C11 (segunda consulta) | pendência sem responsável; vencidas | tela Pendências (`/follow-ups`) |
| "As ligações de saída não saem" | C12, C10 (`call_refused`) | teto do dia, janela, lista de não ligar, recurso desligado | tela Ligações de saída; [`ligacoes-de-saida.md`](../../../docs/doctrine/ligacoes-de-saida.md). Nunca ajude a afrouxar o teto por fora da tela |

Cada achado: o número, a régua, a comparação, a hipótese, o próximo passo.

## Passo 4: o relatório

```markdown
# {organização}: {de} a {até}, fuso {fuso} · comparado a {período anterior}
## Em uma frase
## O que está bem (até 3 números, cada um com a régua)
## O que está travando (achado → hipótese → próximo passo)
## Custo (total da tela Custos; por modelo e por desfecho; quantas linhas sem custo medido)
## O que NÃO medi, e por quê
```

Números em tabela, prosa curta. Medido às {hora}, para os números que dependem do "agora".

## O que você nunca faz

- Não lê transcrição, resumo, recado, a frase do desfecho, o texto da análise, nome nem telefone,
  nem "só para entender".
- Não roda `select *`, não lê o `payload` inteiro, não copia linha de ligação para arquivo.
- Não escreve no banco. Nunca.
- Não desfaz o envelope: a consulta não leva `commit`, `set role`, `reset role` nem
  `set … read_only`. O `deskvoice` é superusuário; o envelope barra o engano, não quem o desfaz.
- Não roda consulta sem o filtro `organization_id`, nem fora do envelope (a C0 é a única exceção, e
  devolve só um id).
- Não compara número de tela com número de consulta sem dizer que as réguas diferem.
- Não afirma tendência com uma semana de dado.
